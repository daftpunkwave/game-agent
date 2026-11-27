/**
 * Random identifier of one game-agent installation.
 *
 * Responsibilities: Return a stable random UUID for the installation, creating and persisting it on first use.
 * Contracts: The identifier lives in `.anonymous-user-id` under the game-agent home (`GAME_AGENT_HOME`, default
 * `~/.game-agent`). A missing, unreadable, or malformed file yields a fresh identifier that is written back; when
 * the write fails, the fresh identifier is still returned for this process. Results are memoized per file path.
 * Constraints: The identifier is derived from nothing but randomness, carries no personal data, and is never sent
 * anywhere by this package; callers decide whether to attach it to anything.
 */
import { randomUUID as defaultRandomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Branded } from '@game-agent/brand'
import { resolveGameAgentHome } from '@game-agent/home-paths'

/** Random identifier of one installation. */
export type AnonymousUserId = Branded<'AnonymousUserId'>

/** File name of the identifier inside the game-agent home. */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

/** Overrides for tests: the environment that locates the home and the UUID source. */
export interface AnonymousUserIdOptions {
  env?: NodeJS.ProcessEnv
  randomUUID?: () => string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const memo = new Map<string, AnonymousUserId>()

function readPersisted(file: string): AnonymousUserId | undefined {
  try {
    const value = readFileSync(file, 'utf8').trim()
    return UUID_PATTERN.test(value) ? (value as AnonymousUserId) : undefined
  } catch {
    return undefined
  }
}

/**
 * Return the installation identifier, creating it on first use.
 * @param options - environment and UUID source overrides.
 * @returns the persisted identifier, or a fresh one when none can be read.
 */
export function getOrCreateAnonymousUserId(options: AnonymousUserIdOptions = {}): AnonymousUserId {
  const file = join(resolveGameAgentHome(undefined, options.env ?? process.env), ANONYMOUS_USER_ID_FILE_NAME)
  const cached = memo.get(file)
  if (cached !== undefined) return cached
  let id = readPersisted(file)
  if (id === undefined) {
    id = (options.randomUUID ?? defaultRandomUUID)() as AnonymousUserId
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${id}\n`, { mode: 0o600 })
    } catch {
      // The identifier still serves this process when the home is not writable.
    }
  }
  memo.set(file, id)
  return id
}
