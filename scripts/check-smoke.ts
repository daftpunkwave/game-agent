/**
 * Responsibilities: Prove that the compiled workspace runs under Node.js itself, which tests do not cover because
 * the test runner resolves every workspace package to its TypeScript source.
 * Contracts: Requires `pnpm build` first. Imports every runtime entry declared in the `exports` of each
 * `packages/<group>/<name>/package.json` the way Node.js resolves it (the source condition and type entries are
 * ignored), then runs `apps/cli/lib/main.js help` in a child process. Prints every failure and exits with code 1
 * when any exists.
 * Constraints: Loading an entry must not need network access; a failure in one entry does not stop the others
 * from being checked; an entry whose compiled file is missing is reported as not built.
 */
import { spawnSync } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Conditions tried, in order, when an export entry is an object, matching how Node.js resolves for itself. */
const RUNTIME_CONDITIONS = ['node', 'import', 'default'] as const

async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

function runtimeTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined
  const conditions = value as Record<string, unknown>
  for (const condition of RUNTIME_CONDITIONS) {
    const target = runtimeTarget(conditions[condition])
    if (target !== undefined) return target
  }
  return undefined
}

async function entriesOf(dir: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { exports?: unknown }
  const exportsField = manifest.exports
  const map = typeof exportsField === 'object' && exportsField !== null && Object.keys(exportsField).every((key) => key.startsWith('.'))
    ? (exportsField as Record<string, unknown>)
    : { '.': exportsField }
  const result: string[] = []
  for (const [key, value] of Object.entries(map)) {
    if (key.includes('*') || key === './package.json') continue
    const target = runtimeTarget(value)
    if (target !== undefined && /\.(js|mjs|cjs)$/.test(target)) result.push(join(dir, target))
  }
  return result
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

async function main(): Promise<number> {
  const root = process.cwd()
  const failures: string[] = []
  let loaded = 0
  for (const group of await listDirectories(join(root, 'packages'))) {
    for (const name of await listDirectories(join(root, 'packages', group))) {
      for (const entry of await entriesOf(join(root, 'packages', group, name))) {
        const where = relative(root, entry).replaceAll('\\', '/')
        if (!(await exists(entry))) {
          failures.push(`${where}: not built; run \`pnpm build\` first`)
          continue
        }
        try {
          await import(pathToFileURL(entry).href)
          loaded += 1
        } catch (error) {
          failures.push(`${where}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
        }
      }
    }
  }
  const cliEntry = join(root, 'apps/cli/lib/main.js')
  if (!(await exists(cliEntry))) failures.push('apps/cli/lib/main.js: not built; run `pnpm build` first')
  else {
    const cli = spawnSync(process.execPath, [cliEntry, 'help'], { encoding: 'utf8' })
    if (cli.status !== 0) failures.push(`apps/cli/lib/main.js help: exit code ${String(cli.status)}: ${(cli.stderr || cli.stdout).split('\n')[0] ?? ''}`)
  }
  for (const failure of failures) process.stderr.write(`${failure}\n`)
  process.stdout.write(`check:smoke loaded ${loaded} compiled package entries and ran the CLI, ${failures.length} failure(s)\n`)
  return failures.length === 0 ? 0 : 1
}

process.exitCode = await main()
