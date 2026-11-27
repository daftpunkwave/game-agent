/**
 * Responsibilities: Public entry of the boot layer: the kernel host service and the per-agent scheduler.
 * Contracts: `GameAgentHost` is a kernel service plugin registered as `ctx.gameAgents`; `createAppContext` returns a fresh root context.
 * Constraints: The same plugins run in a standalone process (CLI) and in a cluster shard.
 */
import { Context } from '@game-agent/kernel'

export * from './host.ts'
export * from './scheduler.ts'

/** Create an empty kernel root context for a game-agent process. */
export function createAppContext(): Context {
  return new Context()
}
