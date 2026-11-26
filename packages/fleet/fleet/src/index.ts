/**
 * Responsibilities: Public entry of the fleet package used by operators to manage many agents.
 * Contracts: Re-exports the fleet model, the operator command surface, and file storage.
 * Constraints: Game-specific operator commands (granting items, adjusting currencies in-game) belong to game adapters, not here.
 */
export * from './fleet.ts'
export * from './model.ts'
export * from './storage.ts'
