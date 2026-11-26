/**
 * Responsibilities: Public entry of the bounded decision package used by AI nodes.
 * Contracts: Re-exports the model port, the scripted model, and the decision engine.
 * Constraints: Depends only on shared contracts; provider adapters depend on this package, never the reverse.
 */
export * from './engine.ts'
export * from './model.ts'
