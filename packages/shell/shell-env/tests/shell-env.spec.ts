/**
 * Registry tests for `@game-agent/shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@game-agent/kernel'
import type { ToolCallId } from '@game-agent/llm'
import type { Agent } from '@game-agent/agent'
import { SESSION_FORMAT_VERSION } from '@game-agent/session'
import type { ToolExecution } from '@game-agent/tools'
import { ShellEnvRegistry } from '@game-agent/shell-env'
import * as BashEnvPlugin from '@game-agent/shell-env'
import { brandString } from '@game-agent/brand'

const testToolSignal = new AbortController().signal

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: brandString<ToolCallId>('bash-env-call'),
    rootCallId: brandString<ToolCallId>('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : {
        agent: {
          session: {
            header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false },
          },
        } as unknown as Agent,
      }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { gameAgentHome: './test-game-agent-home' })

    expect(registry.collect(execution())).toEqual({
      GAME_AGENT_HOME: resolve('./test-game-agent-home'),
      GAME_AGENT_NODE_EXECUTABLE: process.execPath,
      GAME_AGENT_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      GAME_AGENT_HOME: resolve('./test-game-agent-home'),
      GAME_AGENT_NODE_EXECUTABLE: process.execPath,
      GAME_AGENT_SESSION_ID: 'session-a',
      GAME_AGENT_SHELL: '1',
    })
  })

  it('omits the Node executable inside a single-executable application', () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue({ isSea: () => true })
    expect(new ShellEnvRegistry(new Context()).collect(execution())).not.toHaveProperty('GAME_AGENT_NODE_EXECUTABLE')
  })

  it('keeps the Node executable where the runtime answers no single-executable module', () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined)
    expect(new ShellEnvRegistry(new Context()).collect(execution()).GAME_AGENT_NODE_EXECUTABLE).toBe(process.execPath)
  })

  it('collects the launcher-provided profile name, directory, and installation directory when a profile context exists', () => {
    const ctx = new Context()
    ctx.provide('profileContext', {
      name: 'web', dir: '/profiles/web', patchPath: '/profiles/web/game-agent.patch.yml', installAnchor: '/game-agent/package.json',
      cwd: '/work', home: '/home', startedBundles: [], overlayPaths: [], telemetryDisabledEnv: undefined,
    })
    const registry = new ShellEnvRegistry(ctx, { gameAgentHome: './test-game-agent-home' })
    expect(registry.collect(execution())).toMatchObject({
      GAME_AGENT_INSTALL_DIR: '/game-agent', GAME_AGENT_PROFILE: 'web', GAME_AGENT_PROFILE_DIR: '/profiles/web',
    })
    for (const key of ['GAME_AGENT_PROFILE', 'GAME_AGENT_INSTALL_DIR', 'GAME_AGENT_NODE_EXECUTABLE']) {
      expect(() => registry.register({
        name: `${key}-claimer`,
        variables: { [key]: { description: 'Reserved key.' } },
        resolve: () => ({}),
      })).toThrow(new RegExp(`reserved key "${key}"`))
    }
  })

  it('resolves GAME_AGENT_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('GAME_AGENT_HOME', './ambient-game-agent-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).GAME_AGENT_HOME).toBe(resolve('./ambient-game-agent-home'))

    vi.stubEnv('GAME_AGENT_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).GAME_AGENT_HOME).toBe(join(homedir(), '.game-agent'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { gameAgentHome: './test-game-agent-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        GAME_AGENT_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { GAME_AGENT_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        GAME_AGENT_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ GAME_AGENT_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('GAME_AGENT_SESSION_OPTIONAL')
    expect(registry.collect(execution()).GAME_AGENT_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).GAME_AGENT_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'GAME_AGENT_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'GAME_AGENT_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { gameAgentHome: './test-game-agent-home' })
    registry.register({
      name: 'first',
      variables: { GAME_AGENT_SHARED: { description: 'First owner.' } },
      resolve: () => ({ GAME_AGENT_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { GAME_AGENT_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ GAME_AGENT_SHARED: 'second' }),
    })).toThrow(/GAME_AGENT_SHARED.*first.*second|GAME_AGENT_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { gameAgentHome: './test-game-agent-home' })
    registry.register({
      name: 'declared',
      variables: { GAME_AGENT_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { GAME_AGENT_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { GAME_AGENT_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { game_agent_invalid: { description: 'Invalid key.' } } as unknown as Record<'GAME_AGENT_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { GAME_AGENT_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { GAME_AGENT_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { gameAgentHome: './test-game-agent-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { GAME_AGENT_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ GAME_AGENT_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*GAME_AGENT_UNDECLARED/)
    expect(() => registry.collect(execution())).toThrow(expect.objectContaining({ name: 'ShellEnvError', code: 'SHELL_ENV_CONTRIBUTION_INVALID' }))
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { gameAgentHome: './test-game-agent-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { GAME_AGENT_STRING: { description: 'String fact.' } },
      resolve: () => ({ GAME_AGENT_STRING: 42 }) as unknown as Record<'GAME_AGENT_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*GAME_AGENT_STRING/)
    expect(() => registry.collect(execution())).toThrow(expect.objectContaining({ name: 'ShellEnvError', code: 'SHELL_ENV_CONTRIBUTION_INVALID' }))
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { gameAgentHome: './test-game-agent-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { GAME_AGENT_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ GAME_AGENT_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).GAME_AGENT_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('GAME_AGENT_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { gameAgentHome: './test-game-agent-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { GAME_AGENT_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ GAME_AGENT_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).GAME_AGENT_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('GAME_AGENT_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service with no contributors on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([])
  })
})
