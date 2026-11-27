/**
 * Shared filesystem path helpers for game-agent user data.
 *
 * @module @game-agent/home-paths
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default game-agent home under the OS home. */
export const GAME_AGENT_HOME_DIR_NAME = '.game-agent'

/** Stable user-facing display form for the default game-agent home. */
export const DEFAULT_GAME_AGENT_HOME_DISPLAY = `~/${GAME_AGENT_HOME_DIR_NAME}`

/** Environment variable that overrides the default game-agent home. */
export const GAME_AGENT_HOME_ENV = 'GAME_AGENT_HOME'

/** Directory name for the default shared agent configuration root under the OS home. */
export const AGENTS_HOME_DIR_NAME = '.agents'

/** Stable user-facing display form for the default shared agent configuration root. */
export const DEFAULT_AGENTS_HOME_DISPLAY = `~/${AGENTS_HOME_DIR_NAME}`

/** Environment variable that overrides the default shared agent configuration root. */
export const AGENTS_HOME_ENV = 'GAME_AGENT_AGENTS_HOME'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default game-agent home using Node's platform path rules.
 * @returns the absolute default game-agent home path.
 */
export function defaultGameAgentHome(): string {
  return join(homedir(), GAME_AGENT_HOME_DIR_NAME)
}

/**
 * Resolve the default shared agent configuration root using Node's platform path rules.
 * @returns the absolute default shared agent configuration root.
 */
export function defaultAgentsHome(): string {
  return join(homedir(), AGENTS_HOME_DIR_NAME)
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve one user-data root from an explicit path, an environment override, and a default.
 * @param configured - explicit path, which has highest precedence.
 * @param env - environment mapping to read.
 * @param envName - environment variable that overrides the default.
 * @param fallback - default root, used when neither the explicit path nor the environment provides one.
 * @returns the normalized absolute root.
 */
function resolveRoot(
  configured: string | undefined,
  env: Record<string, string | undefined>,
  envName: string,
  fallback: () => string,
): string {
  const fromEnv = env[envName]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : fallback())
  return resolve(expandHomePath(selected))
}

/**
 * Label one resolved user-data root symbolically for user-facing display.
 * @param resolvedRoot - absolute path returned by the matching resolver.
 * @param defaultRoot - absolute default root whose symbolic label applies to a match.
 * @param defaultLabel - symbolic label for the default root.
 * @param envName - environment variable name that labels any other root.
 * @returns the symbolic label.
 */
function rootDisplay(resolvedRoot: string, defaultRoot: string, defaultLabel: string, envName: string): string {
  return resolvedRoot === resolve(defaultRoot) ? defaultLabel : `$${envName}`
}

/**
 * Resolve the single-root game-agent home.
 *
 * Precedence, highest first: an explicit configured path, `$GAME_AGENT_HOME`, then
 * `~/.game-agent`. The runtime keeps all user data under one root. An empty or
 * whitespace-only `$GAME_AGENT_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit game-agent home override, which has highest precedence.
 * @param env - environment mapping used to read `GAME_AGENT_HOME`.
 * @returns the normalized absolute game-agent home path.
 */
export function resolveGameAgentHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  return resolveRoot(configured, env, GAME_AGENT_HOME_ENV, defaultGameAgentHome)
}

/**
 * Resolve the shared agent configuration root.
 *
 * Precedence, highest first: an explicit configured path, `$GAME_AGENT_AGENTS_HOME`,
 * then `~/.agents`. The root holds configuration shared with other agent tools,
 * so it stays independent of the game-agent home. An empty or
 * whitespace-only `$GAME_AGENT_AGENTS_HOME` is treated as unset, so a blank override
 * never resolves the root to the current working directory.
 * @param configured - explicit shared-root override, which has highest precedence.
 * @param env - environment mapping used to read `GAME_AGENT_AGENTS_HOME`.
 * @returns the normalized absolute shared agent configuration root.
 */
export function resolveAgentsHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  return resolveRoot(configured, env, AGENTS_HOME_ENV, defaultAgentsHome)
}

/**
 * Join path segments onto the resolved game-agent home. It addresses the
 * existing top-level entries; a new path uses {@link gameAgentPath} with its category.
 * @param segments - path segments appended to the game-agent home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function gameAgentHomePath(...segments: string[]): string {
  return join(resolveGameAgentHome(), ...segments)
}

/**
 * Join path segments onto the resolved game-agent home's `cache` directory without creating it; no arguments returns the directory itself.
 * @param optionsOrSegment - explicit home override, or the first path segment; omission uses the default home resolution.
 * @param segments - additional path segments after the first child, if any.
 * @returns the normalized absolute cache path.
 */
export function gameAgentCachePath(optionsOrSegment: { gameAgentHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return gameAgentPath('cache', optionsOrSegment, ...segments)
  return gameAgentPath({ category: 'cache', gameAgentHome: optionsOrSegment.gameAgentHome }, ...segments)
}

/**
 * Category directory under the game-agent home, named after the XDG Base Directory
 * kinds. A new file kept under `$GAME_AGENT_HOME` belongs to exactly one category, and
 * the category directory name equals the category. Existing top-level entries,
 * such as `sessions/`, `profiles/`, and `.credentials.yaml`, keep their current
 * locations. The categories are:
 *
 * - `config`: files a person writes or edits to configure the runtime.
 * - `data`: durable records whose loss loses user work, sign-ins, or installed
 *   software, such as Sessions, profiles, attachments, credentials, and runtimes.
 * - `state`: records that persist across runs but whose loss only resets
 *   history or derived indexes, such as logs, upload indexes, and ids.
 * - `cache`: content that can be rebuilt or downloaded again.
 * - `backup`: backup archives the runtime writes; deleting them never affects
 *   a running process or the records they copy.
 */
export type GameAgentHomeCategory = 'config' | 'data' | 'state' | 'cache' | 'backup'

/** A category directory under an explicitly configured game-agent home. */
export interface GameAgentPathLocation {
  /** Category directory to join under. */
  category: GameAgentHomeCategory
  /** Explicit game-agent home override, resolved by {@link resolveGameAgentHome}; omission uses `$GAME_AGENT_HOME`, then `~/.game-agent`. */
  gameAgentHome?: string | undefined
}

/**
 * Join path segments onto one category directory of the game-agent home without
 * creating it. An owner passes its own directory name, normally its package
 * name without the `@game-agent/` prefix, as the first segment.
 * @param location - category under the resolved home, or a category with an explicit home override.
 * @param segments - path segments appended to the category directory; an empty list returns the directory itself.
 * @returns the normalized absolute path.
 */
export function gameAgentPath(location: GameAgentHomeCategory | GameAgentPathLocation, ...segments: string[]): string {
  const { category, gameAgentHome } = typeof location === 'string' ? { category: location, gameAgentHome: undefined } : location
  return join(resolveGameAgentHome(gameAgentHome), category, ...segments)
}

/**
 * Describe a resolved game-agent home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.game-agent`, and any configured home is labelled `$GAME_AGENT_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveGameAgentHome}.
 * @returns `~/.game-agent` for the default home, otherwise `$GAME_AGENT_HOME`.
 */
export function gameAgentHomeDisplay(resolvedHome: string): string {
  return rootDisplay(resolvedHome, defaultGameAgentHome(), DEFAULT_GAME_AGENT_HOME_DISPLAY, GAME_AGENT_HOME_ENV)
}

/**
 * Describe a resolved shared agent configuration root symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default root is labelled
 * `~/.agents`, and any configured root is labelled `$GAME_AGENT_AGENTS_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveAgentsHome}.
 * @returns `~/.agents` for the default root, otherwise `$GAME_AGENT_AGENTS_HOME`.
 */
export function agentsHomeDisplay(resolvedHome: string): string {
  return rootDisplay(resolvedHome, defaultAgentsHome(), DEFAULT_AGENTS_HOME_DISPLAY, AGENTS_HOME_ENV)
}
