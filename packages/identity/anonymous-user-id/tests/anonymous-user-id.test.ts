/**
 * Responsibilities: Verify that the installation identifier is created once, persisted, and reused.
 * Contracts: Each test uses its own temporary game-agent home through the GAME_AGENT_HOME variable.
 * Constraints: Touches only temporary directories.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ANONYMOUS_USER_ID_FILE_NAME, getOrCreateAnonymousUserId } from '../src/index.ts'

const homes: string[] = []
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'game-agent-id-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('anonymous user id', () => {
  it('creates, persists, and reuses one identifier per home', () => {
    const dir = home()
    const env = { GAME_AGENT_HOME: dir }
    const id = getOrCreateAnonymousUserId({ env, randomUUID: () => '00000000-0000-4000-8000-000000000001' })
    expect(id).toBe('00000000-0000-4000-8000-000000000001')
    expect(readFileSync(join(dir, ANONYMOUS_USER_ID_FILE_NAME), 'utf8').trim()).toBe(id)
    expect(getOrCreateAnonymousUserId({ env, randomUUID: () => '00000000-0000-4000-8000-000000000002' })).toBe(id)
  })

  it('replaces a malformed file with a fresh identifier', () => {
    const dir = home()
    writeFileSync(join(dir, ANONYMOUS_USER_ID_FILE_NAME), 'not-a-uuid\n')
    const id = getOrCreateAnonymousUserId({ env: { GAME_AGENT_HOME: dir }, randomUUID: () => '00000000-0000-4000-8000-000000000003' })
    expect(id).toBe('00000000-0000-4000-8000-000000000003')
  })
})
