/**
 * Responsibilities: Verify launcher resolution, grant arguments, and the behavior when no platform helper is installed.
 * Contracts: Uses injected resolvers and a nonexistent launcher path; never runs a real launcher.
 * Constraints: No native helper package is installed in the workspace, so the probe must report `unusable`; the file lock test runs only where `flock(2)` exists.
 */
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tryLockExclusive } from '../src/flock.ts'
import { LAUNCHER_BIN, grantArgs, launcherPath, probe } from '../src/landlock-run.ts'

describe('landlock-run', () => {
  it('resolves the launcher inside the platform helper package', () => {
    const path = launcherPath(() => '/opt/helper/package.json')
    expect(path.replaceAll('\\', '/')).toBe(`/opt/helper/bin/${LAUNCHER_BIN}`)
  })

  it('falls back to a nonexistent path inside this package when no helper is installed', () => {
    const path = launcherPath(() => {
      throw new Error('not installed')
    })
    expect(path.replaceAll('\\', '/')).toMatch(new RegExp(`/node_modules/@game-agent/native-system-${process.platform}-${process.arch}/bin/${LAUNCHER_BIN}$`))
  })

  it('turns grants into read-only arguments followed by read-write arguments', () => {
    expect(grantArgs({ readOnly: ['/usr', '/etc'], readWrite: ['/work'] })).toEqual(['--ro', '/usr', '--ro', '/etc', '--rw', '/work'])
    expect(grantArgs({})).toEqual([])
  })

  it('reports a missing launcher as unusable', () => {
    expect(probe()).toBe('unusable')
  })
})

const posix = process.platform === 'linux' || process.platform === 'darwin'

describe('flock', () => {
  it.skipIf(posix)('rejects on platforms without flock(2)', async () => {
    await expect(tryLockExclusive(0)).rejects.toMatchObject({ code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM' })
  })

  it.runIf(posix)('locks a file once and refuses a second open file description', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'game-agent-flock-'))
    const first = openSync(join(dir, 'lock'), 'w')
    const second = openSync(join(dir, 'lock'), 'r')
    try {
      await expect(tryLockExclusive(first)).resolves.toBeUndefined()
      await expect(tryLockExclusive(second)).rejects.toMatchObject({ syscall: 'flock' })
    } finally {
      closeSync(first)
      closeSync(second)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
