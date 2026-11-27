/** Plugin game-agent requirement checks prefer engines.gameAgent, retain exact mismatches, and never inherit exemption entries. */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluatePluginCompatibility, getGameAgentRuntimeVersion, pluginCompatibilityWarning } from '../src/plugin-compatibility.ts'

const runtime = '0.1.7-alpha.1'
const identity = { name: '@example/plugin', version: '2.0.0' }
const incompatible = { ...identity, peerDependencies: { '@game-agent/cli': '^0.2.0' } }

function check(peerDependencies: object) {
  return evaluatePluginCompatibility({ ...identity, peerDependencies }, {}, runtime)
}

afterEach(() => vi.restoreAllMocks())

describe('game-agent runtime version', () => {
  it('reads the exact version with a string path accepted by executable virtual filesystems', () => {
    const { version: expected } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    const read = vi.spyOn(fs, 'readFileSync')
    expect(getGameAgentRuntimeVersion()).toBe(expected)
    expect(semver.valid(expected)).not.toBeNull()
    expect(read).toHaveBeenCalledWith(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
  })

  it.each([{}, { version: null }, { version: 1 }, { version: '' }, { version: 'not-semver' }])(
    'rejects an invalid or absent package version: %j', (manifest) => {
      vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(JSON.stringify(manifest))
      expect(() => getGameAgentRuntimeVersion()).toThrow('Invalid game-agent runtime version')
    },
  )

  it.each(['null', '[]', '1', '"text"'])('rejects non-object package JSON: %s', (contents) => {
    vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(contents)
    expect(() => getGameAgentRuntimeVersion()).toThrow('app-boot package.json must be an object')
  })

  it('propagates malformed JSON and read failures', () => {
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('{')
    expect(() => getGameAgentRuntimeVersion()).toThrow(SyntaxError)
    read.mockImplementationOnce(() => { throw new Error('manifest unavailable') })
    expect(() => getGameAgentRuntimeVersion()).toThrow('manifest unavailable')
  })
})

describe('plugin compatibility', () => {
  it('defaults to the installed runtime and needs no identity without mismatches', () => {
    expect(evaluatePluginCompatibility({})).toBeUndefined()
    expect(evaluatePluginCompatibility({ peerDependencies: { '@game-agent/cli': getGameAgentRuntimeVersion() } })).toBeUndefined()
    expect(check({})).toBeUndefined()
  })

  it.each(['*', '^0.1.0', '~0.1.0', '>=0.1.0 <0.2.0', '0.1.x', '0.1.0 - 0.1.9', '^0.2.0 || ^0.1.0', runtime])(
    'includes prereleases in supported semver range %s', (range) => {
      expect(check({ '@game-agent/cli': range, '@game-agent/session': range })).toBeUndefined()
    },
  )

  it.each(['workspace:^', 'workspace:~', 'workspace:*'])('uses the source runtime for %s', (range) => {
    expect(check({ '@game-agent/session': range })).toBeUndefined()
  })

  it('checks the intersection of game-agent requirements and returns only mismatches', () => {
    expect(check({
      '@game-agent/cli': '^0.1.0',
      '@game-agent/session': '>=0.2.0',
      '@game-agent/tools': '<0.1.0',
      '@other/kernel': '^99.0.0',
    })).toEqual({
      ...identity,
      runtimeVersion: runtime,
      requirements: { '@game-agent/session': '>=0.2.0', '@game-agent/tools': '<0.1.0' },
      exempted: false,
    })
  })

  it.each(['^0.2.0', '>=0.1.7', 'broken', '', ' ', 'workspace:>=0.2.0', 'file:../game-agent', 'npm:game-agent@*'])(
    'fails closed for an incompatible or malformed range %j', (range) => {
      expect(check({ '@game-agent/cli': range })?.requirements).toEqual({ '@game-agent/cli': range })
    },
  )

  it('ignores unrelated names and dependency fields', () => {
    expect(check({
      '@other/kernel': 'broken', '@other/kernel-loader': '^99',
      '@other/game-agent': '^99', '@other-scope/clix': '^99', gameAgent: '^99',
      constructor: '^99', hasOwnProperty: '^99', ['__proto__']: '^99',
    })).toBeUndefined()
    expect(evaluatePluginCompatibility({ dependencies: { '@game-agent/cli': '^99' } }, {}, runtime)).toBeUndefined()
  })

  it.each([null, [], 'bad', 1, false, undefined])('rejects malformed peerDependencies: %j', (peerDependencies) => {
    expect(() => evaluatePluginCompatibility({ ...identity, peerDependencies }, {}, runtime)).toThrow('peerDependencies must be an object')
  })

  it.each([null, [], {}, 1, false, undefined])('rejects non-string peer ranges: %j', (range) => {
    for (const name of ['@game-agent/cli', '@game-agent/kernel']) {
      expect(() => check({ [name]: range })).toThrow(`peerDependencies[${JSON.stringify(name)}] must be a string`)
    }
  })

  it.each(['name', 'version'] as const)('requires own non-empty %s on a mismatch', (field) => {
    for (const value of [undefined, null, '', ' ', 3]) {
      expect(() => evaluatePluginCompatibility({ ...incompatible, [field]: value }, {}, runtime))
        .toThrow(`Plugin manifest ${field} must be a non-empty string`)
    }
    const inherited = Object.assign(
      Object.create({ [field]: identity[field] }) as object,
      Object.fromEntries(Object.entries(incompatible).filter(([name]) => name !== field)),
    )
    expect(() => evaluatePluginCompatibility(inherited, {}, runtime)).toThrow(`Plugin manifest ${field}`)
  })

  it('ignores inherited peer declarations and inherited peer entries', () => {
    expect(evaluatePluginCompatibility(Object.create(incompatible) as object, {}, runtime)).toBeUndefined()
    expect(check(Object.create(incompatible.peerDependencies) as object)).toBeUndefined()
    expect(check(Object.assign(Object.create({ '@game-agent/cli': '^99' }) as object, { '@game-agent/session': '*' }))).toBeUndefined()
  })

  it('rejects an invalid explicit runtime even when no peers are declared', () => {
    expect(() => evaluatePluginCompatibility({}, {}, 'invalid')).toThrow('Invalid game-agent runtime version')
  })

  it('rejects array plugin manifests', () => {
    expect(() => evaluatePluginCompatibility([], {}, runtime)).toThrow('Plugin manifest must be an object')
  })
})

describe('engines.gameAgent', () => {
  const failingPeers = { '@game-agent/cli': '^0.2.0' }
  const passingPeers = { '@game-agent/cli': '*' }
  function engines(gameAgent: unknown, peerDependencies: object = {}) {
    return evaluatePluginCompatibility({ ...identity, engines: { gameAgent }, peerDependencies }, {}, runtime)
  }

  it.each(['^0.1.0', '>=0.1.7-alpha.0', '0.1.x', runtime])('decides alone when satisfied by %s, ignoring failing peers', (range) => {
    expect(engines(range, failingPeers)).toBeUndefined()
  })

  it('decides alone when unsatisfied, ignoring passing peers', () => {
    expect(engines('^0.2.0', passingPeers)).toEqual({
      ...identity, runtimeVersion: runtime, requirements: { 'engines.gameAgent': '^0.2.0' }, exempted: false,
    })
  })

  it.each(['', ' ', 'broken', 'workspace:^', 'workspace:*', 'workspace:~'])('treats %j as an unmet range', (range) => {
    expect(engines(range, passingPeers)?.requirements).toEqual({ 'engines.gameAgent': range })
  })

  it.each([null, [], 'bad', 1, false, undefined])('rejects malformed engines: %j', (value) => {
    expect(() => evaluatePluginCompatibility({ ...identity, engines: value }, {}, runtime)).toThrow('Plugin manifest engines must be an object')
  })

  it.each([null, [], {}, 1, false, undefined])('rejects a non-string engines.gameAgent: %j', (value) => {
    expect(() => engines(value, passingPeers)).toThrow('Plugin manifest engines.gameAgent must be a string')
  })

  it('falls back to peers when engines has no own game-agent member', () => {
    const inherited = Object.create({ gameAgent: '*' }) as object
    for (const value of [{}, { node: '>=99' }, inherited]) {
      expect(evaluatePluginCompatibility({ ...identity, engines: value, peerDependencies: failingPeers }, {}, runtime)?.requirements)
        .toEqual(failingPeers)
      expect(evaluatePluginCompatibility({ ...identity, engines: value, peerDependencies: passingPeers }, {}, runtime)).toBeUndefined()
    }
    expect(evaluatePluginCompatibility(Object.create({ engines: { gameAgent: '^0.2.0' } }) as object, {}, runtime)).toBeUndefined()
  })

  it('applies exact-version exemptions to an engines mismatch', () => {
    const manifest = { ...identity, engines: { gameAgent: '^0.2.0' } }
    expect(evaluatePluginCompatibility(manifest, { '@example/plugin@2.0.0': [runtime] }, runtime)).toMatchObject({
      requirements: { 'engines.gameAgent': '^0.2.0' }, exempted: true,
    })
  })
})

describe('exact-version exemptions', () => {
  const exemptions = { '@example/plugin@2.0.0': [runtime] }

  it('exempts only the exact scoped plugin and runtime versions', () => {
    expect(evaluatePluginCompatibility(incompatible, exemptions, runtime)?.exempted).toBe(true)
    expect(evaluatePluginCompatibility({ ...incompatible, version: '2.0.1' }, exemptions, runtime)?.exempted).toBe(false)
    expect(evaluatePluginCompatibility({ ...incompatible, name: '@other/plugin' }, exemptions, runtime)?.exempted).toBe(false)
    expect(evaluatePluginCompatibility(incompatible, exemptions, '0.1.7-alpha.2')?.exempted).toBe(false)
    expect(evaluatePluginCompatibility(incompatible, exemptions, `${runtime}+build`)?.exempted).toBe(false)
  })

  it.each(['*', '^0.1.0', '0.1.7', '0.1.7-alpha.2'])('does not interpret exemption value %s as a range', (version) => {
    expect(evaluatePluginCompatibility(incompatible, { '@example/plugin@2.0.0': [version] }, runtime)?.exempted).toBe(false)
  })

  it('does not accept inherited exemptions, but accepts own entries on null-prototype maps', () => {
    expect(evaluatePluginCompatibility(incompatible, Object.create(exemptions) as typeof exemptions, runtime)?.exempted).toBe(false)
    const ownExemptions = Object.assign(Object.create(null) as object, exemptions)
    expect(evaluatePluginCompatibility(incompatible, ownExemptions, runtime)?.exempted).toBe(true)
  })

  it.each(['constructor', 'hasOwnProperty', '__proto__'])('handles plugin identity %s without prototype lookup', (name) => {
    const manifest = { ...incompatible, name }
    expect(evaluatePluginCompatibility(manifest, {}, runtime)?.exempted).toBe(false)
    expect(evaluatePluginCompatibility(manifest, { [`${name}@2.0.0`]: [runtime] }, runtime)?.exempted).toBe(true)
  })

  it('does not produce issues for compatible exempted plugins', () => {
    expect(evaluatePluginCompatibility({ ...identity, peerDependencies: { '@game-agent/cli': '*' } }, exemptions, runtime)).toBeUndefined()
  })
})

describe('compatibility warning', () => {
  it.each([false, true])('retains mismatch details and risk when exemption status is %s', (exempted) => {
    expect(pluginCompatibilityWarning({
      ...identity, runtimeVersion: runtime,
      requirements: { '@game-agent/cli': '^0.2.0', '@game-agent/session': 'broken' }, exempted,
    })).toBe(
      'Plugin @example/plugin@2.0.0 is incompatible with game-agent 0.1.7-alpha.1: '
      + 'requirements {"@game-agent/cli":"^0.2.0","@game-agent/session":"broken"}. '
      + 'Running it may cause crashes or data loss. '
      + 'Update the plugin or install a plugin version compatible with this game-agent runtime. '
      + 'To accept this risk explicitly, grant the exact-version exemption for @example/plugin@2.0.0 on game-agent 0.1.7-alpha.1 '
      + 'with `game-agent plugin allow-version` or the plugin manager, then retry the installation or restart game-agent. '
      + `Exact-version exemption: ${exempted ? 'active' : 'not active'}.`,
    )
  })
})
