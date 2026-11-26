/**
 * Responsibilities: Public entry of the boot layer: the Cordis host service and the per-agent scheduler.
 * Contracts: `GameAgentHost` is a Cordis service plugin registered as `ctx.gameAgents`; `createAppContext` returns a fresh root context.
 * Constraints: The same plugins run in a standalone process (CLI, cluster shard) and inside DeepSeek Harness through the DSH bundle.
 */
import { Context } from '@deepseek-ai/cordis'

export * from './host.ts'
export * from './scheduler.ts'

/** Create an empty Cordis root context for a game-agent process. */
export function createAppContext(): Context {
  return new Context()
}
