/**
 * Locate and probe the Linux Landlock launcher that confines subprocesses.
 *
 * Responsibilities: Resolve the launcher executable from the platform helper package, build its grant arguments,
 * and report how much confinement the launcher can enforce on this host.
 * Contracts: The launcher lives at `bin/landlock-run` inside `@game-agent/native-system-<platform>-<arch>`. Grants
 * become `--ro <root>` and `--rw <root>` arguments in the given order. `probe` runs `<launcher> --probe` and reports
 * `full`, `partial` (the launcher printed "partially enforced"), or `unusable` (missing launcher, non-zero exit,
 * or timeout).
 * Constraints: Never builds or downloads native code. When no platform helper package is installed, the resolved
 * path is absolute, inside this package, and does not exist, so callers see `unusable` instead of running an
 * executable chosen by the working directory.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** File name of the launcher inside the platform helper package's `bin/` directory. */
export const LAUNCHER_BIN = 'landlock-run'

/** Exit code the launcher uses when it cannot set up confinement before running the target. */
export const LAUNCHER_FAILURE_EXIT = 125

/** How much filesystem confinement the launcher enforces on this host. */
export type LandlockEnforcement = 'full' | 'partial' | 'unusable'

/** Filesystem roots the confined process may use. */
export interface LauncherGrants {
  /** Roots granted read and execute access beneath them. */
  readonly readOnly?: readonly string[]
  /** Roots granted full access beneath them. */
  readonly readWrite?: readonly string[]
}

/**
 * Resolve the launcher executable for the current platform.
 * @param resolvePackageJson - resolves a `package.json` specifier to an absolute path; injectable for tests.
 * @returns the absolute launcher path; it does not exist when no platform helper package is installed.
 */
export function launcherPath(
  resolvePackageJson: (specifier: string) => string = createRequire(import.meta.url).resolve,
): string {
  const helper = `@game-agent/native-system-${process.platform}-${process.arch}`
  try {
    return join(dirname(resolvePackageJson(`${helper}/package.json`)), 'bin', LAUNCHER_BIN)
  } catch {
    return fileURLToPath(new URL(`../node_modules/${helper}/bin/${LAUNCHER_BIN}`, import.meta.url))
  }
}

/**
 * Turn grants into launcher arguments.
 * @param grants - read-only and read-write roots.
 * @returns `--ro` arguments followed by `--rw` arguments.
 */
export function grantArgs(grants: LauncherGrants): string[] {
  return [
    ...(grants.readOnly ?? []).flatMap((root) => ['--ro', root]),
    ...(grants.readWrite ?? []).flatMap((root) => ['--rw', root]),
  ]
}

/**
 * Ask the launcher how much confinement it can enforce.
 * @param launcher - launcher path; defaults to {@link launcherPath}.
 * @param options - probe timeout in milliseconds (default 2000).
 * @returns the enforcement level; `unusable` when the launcher is missing, fails, or times out.
 */
export function probe(launcher: string = launcherPath(), options: { timeoutMs?: number } = {}): LandlockEnforcement {
  const result = spawnSync(launcher, ['--probe'], {
    timeout: options.timeoutMs ?? 2000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return 'unusable'
  return /partially enforced/.test(result.stdout) ? 'partial' : 'full'
}
