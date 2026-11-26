/**
 * Responsibilities: Public entry of the shared contracts package.
 * Contracts: Re-exports JSON, game-protocol, and cognition-facing types plus the schema validator.
 * Constraints: Contains no runtime state; every package may depend on it, and it depends on nothing.
 */
export * from './json.ts'
export type * from './game.ts'
export type * from './agent.ts'
