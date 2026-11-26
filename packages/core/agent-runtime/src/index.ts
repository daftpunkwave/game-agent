/**
 * Responsibilities: Public entry of the single-agent runtime.
 * Contracts: Re-exports `AgentRuntime` and its option, step, and status types.
 * Constraints: Composition (which transport, model, and policies) belongs to the boot layer, not here.
 */
export * from './runtime.ts'
