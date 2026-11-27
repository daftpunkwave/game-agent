import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_GAME_AGENT_HOME_DISPLAY,
  GAME_AGENT_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultGameAgentHome,
  gameAgentCachePath,
  gameAgentHomeDisplay,
  gameAgentHomePath,
  gameAgentPath,
  expandHomePath,
  resolveAgentsHome,
  resolveGameAgentHome,
} from '@game-agent/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('gameAgent path helpers', () => {
  it('owns the shared default game-agent home directory name', () => {
    expect(GAME_AGENT_HOME_DIR_NAME).toBe('.game-agent')
    expect(DEFAULT_GAME_AGENT_HOME_DISPLAY).toBe('~/.game-agent')
    expect(defaultGameAgentHome()).toBe(join(homedir(), '.game-agent'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.game-agent')).toBe(join(homedir(), '.game-agent'))
    expect(expandHomePath('~\\.game-agent')).toBe(join(homedir(), '.game-agent'))
    expect(expandHomePath('/tmp/.game-agent')).toBe('/tmp/.game-agent')
    expect(expandHomePath('~other/.game-agent')).toBe('~other/.game-agent')
  })

  it('resolves explicit path before GAME_AGENT_HOME and the default', () => {
    const envHome = join(homedir(), 'env-game-agent')

    expect(resolveGameAgentHome('/tmp/explicit-game-agent', { GAME_AGENT_HOME: '~/env-game-agent' })).toBe(resolve('/tmp/explicit-game-agent'))
    expect(resolveGameAgentHome(undefined, { GAME_AGENT_HOME: '~/env-game-agent' })).toBe(envHome)
    expect(resolveGameAgentHome(undefined, {})).toBe(defaultGameAgentHome())
  })

  it('treats an empty or whitespace-only GAME_AGENT_HOME as unset', () => {
    expect(resolveGameAgentHome(undefined, { GAME_AGENT_HOME: '' })).toBe(defaultGameAgentHome())
    expect(resolveGameAgentHome(undefined, { GAME_AGENT_HOME: '   ' })).toBe(defaultGameAgentHome())
  })

  it('joins child segments onto the resolved GAME_AGENT_HOME', () => {
    vi.stubEnv('GAME_AGENT_HOME', '~/env-game-agent')
    expect(gameAgentHomePath()).toBe(join(homedir(), 'env-game-agent'))
    expect(gameAgentHomePath('storages', 'cache')).toBe(join(homedir(), 'env-game-agent', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(gameAgentHomeDisplay(resolve(defaultGameAgentHome()))).toBe('~/.game-agent')
    expect(gameAgentHomeDisplay('/some/other/root')).toBe('$GAME_AGENT_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before GAME_AGENT_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { GAME_AGENT_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { GAME_AGENT_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only GAME_AGENT_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { GAME_AGENT_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { GAME_AGENT_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$GAME_AGENT_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.game-agent')],
    ['', join(homedir(), '.game-agent')],
    ['   ', join(homedir(), '.game-agent')],
    ['~/env-game-agent', join(homedir(), 'env-game-agent')],
    ['./relative-game-agent', resolve('./relative-game-agent')],
  ] as const)('resolves cache paths with GAME_AGENT_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('GAME_AGENT_HOME', home)
    try {
      expect(gameAgentCachePath()).toBe(join(expectedHome, 'cache'))
      expect(gameAgentCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('GAME_AGENT_HOME', '~/env-game-agent')
    try {
      expect(gameAgentCachePath({ gameAgentHome: '~/explicit-game-agent' })).toBe(join(homedir(), 'explicit-game-agent', 'cache'))
      expect(gameAgentCachePath({ gameAgentHome: './explicit-game-agent' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-game-agent/cache/attachments/request-images'))
      expect(gameAgentCachePath({}, 'attachments')).toBe(join(homedir(), 'env-game-agent', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    [undefined, join(homedir(), '.game-agent')],
    ['', join(homedir(), '.game-agent')],
    ['~/env-game-agent', join(homedir(), 'env-game-agent')],
    ['./relative-game-agent', resolve('./relative-game-agent')],
  ] as const)('resolves category paths with GAME_AGENT_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('GAME_AGENT_HOME', home)
    for (const category of ['config', 'data', 'state', 'cache', 'backup'] as const) {
      expect(gameAgentPath(category)).toBe(join(expectedHome, category))
      expect(gameAgentPath(category, 'owner', 'file.json')).toBe(join(expectedHome, category, 'owner', 'file.json'))
    }
  })

  it('resolves a configured category home before the environment', () => {
    vi.stubEnv('GAME_AGENT_HOME', '~/env-game-agent')
    expect(gameAgentPath({ category: 'state', gameAgentHome: '~/explicit-game-agent' }, 'logs')).toBe(join(homedir(), 'explicit-game-agent', 'state', 'logs'))
    expect(gameAgentPath({ category: 'data', gameAgentHome: undefined })).toBe(join(homedir(), 'env-game-agent', 'data'))
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-agent-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
