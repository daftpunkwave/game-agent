/**
 * Responsibilities: Verify launcher resolution, grant arguments, and the behavior when no platform helper is installed.
 * Contracts: Uses injected resolvers and a nonexistent launcher path; never runs a real launcher.
 * Constraints: No native helper package is installed in the workspace, so the probe must report `unusable`.
 */
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

describe('flock', () => {
  it('rejects when no native binding is available', async () => {
    await expect(tryLockExclusive(0)).rejects.toThrow()
  })
})
