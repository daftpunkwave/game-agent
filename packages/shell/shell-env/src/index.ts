/**
 * Tool-independent shell environment plugin: owns the `ctx.shellEnv` registry of
 * trusted, per-execution `GAME_AGENT_*` variables consumed by the model-facing shell
 * tools (`@game-agent/tool-bash`, `@game-agent/tool-pwsh`). Built-in shell facts are owned by
 * the registry itself while plugins can register additional, enumerable facts
 * with effect-scoped disposal.
 *
 * @module @game-agent/shell-env
 */

import { dirname } from 'node:path'
import { Service, type Context } from '@game-agent/kernel'
import z from '@game-agent/schema'
import { GAME_AGENT_ENV_PREFIX } from '@game-agent/shell'
import type { GameAgentEnvironment, GameAgentEnvironmentKey } from '@game-agent/shell'
import { GAME_AGENT_HOME_ENV, resolveGameAgentHome } from '@game-agent/home-paths'
import { ShellEnvError } from './error.ts'
import type { ToolExecution } from '@game-agent/tools'
// Declares `Context.profileContext`, the launcher-provided profile the built-ins read.
import type {} from '@game-agent/app-boot'

export { ShellEnvError, type ShellEnvErrorCode } from './error.ts'

declare module '@game-agent/kernel' {
  interface Context {
    shellEnv: ShellEnvRegistry
  }
}

export const name = 'shell-env'
export const inject: string[] = []

/** Plugin config (all optional — the built-in facts resolve without defaults). */
export interface Config {
  /** game-agent home directory exposed as `GAME_AGENT_HOME`; defaults to `$GAME_AGENT_HOME` or `~/.game-agent`. */
  gameAgentHome?: string
}

/** Runtime configuration schema for the shell-env plugin. */
export const Config: z<Config> = z.object({
  gameAgentHome: z.string(),
})

/** Model-visible metadata for one managed `GAME_AGENT_*` environment variable. */
export interface BashEnvVariable {
  /** Concise description of the environment fact represented by the variable. */
  description: string
}

/**
 * A plugin contribution to the managed environment of each model shell call.
 * Declared keys make ownership conflicts detectable before the first command;
 * `resolve` computes only the values available for the current execution.
 */
export interface BashEnvContributor {
  /** Stable contributor name used in diagnostics and duplicate detection. */
  name: string
  /** Complete set of `GAME_AGENT_*` keys this contributor may return. */
  variables: Readonly<Record<GameAgentEnvironmentKey, BashEnvVariable>>
  /**
   * Resolve this contributor's available values for one tool execution.
   * @param execution - the shell tool execution and its optional calling agent.
   * @returns a partial map containing only keys declared in {@link variables}.
   */
  resolve(execution: ToolExecution): Readonly<Partial<Record<GameAgentEnvironmentKey, string>>>
}

/** An enumerable declaration returned by {@link ShellEnvRegistry.list}. */
export interface BashEnvVariableInfo extends BashEnvVariable {
  /** Contributor that owns the variable. */
  contributor: string
  /** Declared `GAME_AGENT_*` environment variable name. */
  key: GameAgentEnvironmentKey
}

const GAME_AGENT_SHELL_KEY = `${GAME_AGENT_ENV_PREFIX}SHELL` as const
const GAME_AGENT_SESSION_ID_KEY = `${GAME_AGENT_ENV_PREFIX}SESSION_ID` as const
const GAME_AGENT_PROFILE_KEY = `${GAME_AGENT_ENV_PREFIX}PROFILE` as const
const GAME_AGENT_PROFILE_DIR_KEY = `${GAME_AGENT_ENV_PREFIX}PROFILE_DIR` as const
const GAME_AGENT_INSTALL_DIR_KEY = `${GAME_AGENT_ENV_PREFIX}INSTALL_DIR` as const
const GAME_AGENT_NODE_EXECUTABLE_KEY = `${GAME_AGENT_ENV_PREFIX}NODE_EXECUTABLE` as const
const RESERVED_BASH_ENV_KEYS = new Set<GameAgentEnvironmentKey>([
  GAME_AGENT_HOME_ENV,
  GAME_AGENT_SHELL_KEY,
  GAME_AGENT_SESSION_ID_KEY,
  GAME_AGENT_PROFILE_KEY,
  GAME_AGENT_PROFILE_DIR_KEY,
  GAME_AGENT_INSTALL_DIR_KEY,
  GAME_AGENT_NODE_EXECUTABLE_KEY,
])
const BASH_ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/

/**
 * Registry (`ctx.shellEnv`) for trusted, per-execution `GAME_AGENT_*` variables.
 * The namespace is rebuilt for every model shell call: ambient `GAME_AGENT_*` values
 * are discarded by the executor, then the registry's current snapshot is
 * injected. Built-in shell facts remain owned by the registry itself while
 * plugins can register additional, enumerable facts with effect-scoped
 * disposal.
 */
export class ShellEnvRegistry extends Service {
  private readonly contributors = new Map<string, BashEnvContributor>()
  private readonly keyOwners = new Map<GameAgentEnvironmentKey, string>()
  private readonly gameAgentHome: string

  /**
   * Create and install the `ctx.shellEnv` service.
   * @param ctx - Kernel context that owns the service and registrations.
   * @param config - home-directory configuration for the built-in variables.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'shellEnv')
    this.gameAgentHome = resolveGameAgentHome(config.gameAgentHome)
  }

  /**
   * Register one environment contributor. Names and keys are unique; built-in
   * keys are reserved. Registration is disposed with the calling plugin fiber.
   * @param contributor - declared key ownership and per-execution resolver.
   * @returns the disposer that unregisters the contribution.
   */
  register(contributor: BashEnvContributor): () => void {
    const dispose = this.ctx.effect(function* (this: ShellEnvRegistry) {
      if (contributor.name.trim().length === 0) {
        throw new Error('bash env contributor name must be non-empty')
      }
      if (this.contributors.has(contributor.name)) {
        throw new Error(`bash env contributor "${contributor.name}" is already registered`)
      }

      const variables = Object.entries(contributor.variables) as [GameAgentEnvironmentKey, BashEnvVariable][]
      for (const [key, variable] of variables) {
        if (!key.startsWith(GAME_AGENT_ENV_PREFIX)
          || !BASH_ENV_KEY_SUFFIX.test(key.slice(GAME_AGENT_ENV_PREFIX.length))) {
          throw new Error(`bash env contributor "${contributor.name}" declared invalid key "${key}"`)
        }
        if (RESERVED_BASH_ENV_KEYS.has(key)) {
          throw new Error(`bash env contributor "${contributor.name}" cannot own reserved key "${key}"`)
        }
        if (variable.description.trim().length === 0) {
          throw new Error(`bash env contributor "${contributor.name}" must describe "${key}"`)
        }
        const owner = this.keyOwners.get(key)
        if (owner !== undefined) {
          throw new Error(`bash env key "${key}" is already owned by contributor "${owner}"; contributor "${contributor.name}" cannot also own it`)
        }
      }

      this.contributors.set(contributor.name, contributor)
      for (const [key] of variables) this.keyOwners.set(key, contributor.name)
      yield () => {
        this.contributors.delete(contributor.name)
        for (const [key] of variables) this.keyOwners.delete(key)
      }
    }.bind(this), 'bashEnv.register()')
    return () => void dispose()
  }

  /**
   * Build the trusted `GAME_AGENT_*` snapshot for one shell tool execution.
   * @param execution - the current tool execution.
   * @returns an immutable environment overlay containing built-ins and current contributions.
   */
  collect(execution: ToolExecution): GameAgentEnvironment {
    const values: Record<GameAgentEnvironmentKey, string> = {
      [GAME_AGENT_HOME_ENV]: this.gameAgentHome,
      [GAME_AGENT_SHELL_KEY]: '1',
    }
    // A single-executable application runs its embedded entry instead of a script argument. The
    // browser worker image answers no `node:sea`, so the module is looked up at run time.
    const sea = process.getBuiltinModule('node:sea') as typeof import('node:sea') | undefined
    if (sea === undefined || !sea.isSea()) values[GAME_AGENT_NODE_EXECUTABLE_KEY] = process.execPath
    if (execution.agent !== undefined) {
      values[GAME_AGENT_SESSION_ID_KEY] = execution.agent.session.header.id
    }
    const profile = this.ctx.get('profileContext')
    if (profile !== undefined) {
      values[GAME_AGENT_PROFILE_KEY] = profile.name
      values[GAME_AGENT_PROFILE_DIR_KEY] = profile.dir
      values[GAME_AGENT_INSTALL_DIR_KEY] = dirname(profile.installAnchor)
    }

    for (const contributor of [...this.contributors.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = contributor.resolve(execution)
      for (const [rawKey, value] of Object.entries(resolved)) {
        const key = rawKey as GameAgentEnvironmentKey
        if (!Object.hasOwn(contributor.variables, key)) {
          throw new ShellEnvError(`bash env contributor "${contributor.name}" returned undeclared key "${key}"`, 'SHELL_ENV_CONTRIBUTION_INVALID')
        }
        if (typeof value !== 'string') {
          throw new ShellEnvError(
            `bash env contributor "${contributor.name}" returned a non-string value for "${key}"`,
            'SHELL_ENV_CONTRIBUTION_INVALID',
          )
        }
        values[key] = value
      }
    }

    return Object.freeze(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))))
  }

  // Open issue: Include registry-owned built-ins before diagnostics,
  // prompt, or UI code treats list() as an exhaustive environment catalog.
  /**
   * Enumerate plugin-contributed variables without executing their resolvers.
   * @returns declarations sorted by environment variable name.
   */
  list(): BashEnvVariableInfo[] {
    return [...this.contributors.values()]
      .flatMap(contributor => Object.entries(contributor.variables).map(([key, variable]) => ({
        contributor: contributor.name,
        description: variable.description,
        key: key as GameAgentEnvironmentKey,
      })))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}

/**
 * Load the shell-env plugin: register the `ctx.shellEnv` registry service.
 * @param ctx - Kernel context that owns the service and registrations.
 * @param config - home-directory configuration for the built-in variables.
 */
export function apply(ctx: Context, config: Config = {}): void {
  new ShellEnvRegistry(ctx, config)
}
