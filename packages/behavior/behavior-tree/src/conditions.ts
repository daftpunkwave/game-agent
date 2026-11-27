/**
 * Responsibilities: Register the named predicates that condition nodes evaluate, including the built-in blackboard checks.
 * Contracts: A predicate is pure with respect to its inputs and returns a boolean; unknown names fail the node instead of throwing.
 * Constraints: Predicates read only the blackboard and the time they are given; game-specific predicates are registered by plugins.
 */
import type { JsonObject, JsonValue } from '@game-agent/contracts'
import { GameAgentError } from '@game-agent/error'

/** Inputs available to a predicate. */
export interface ConditionInput {
  readonly args: JsonObject
  readonly blackboard: ReadonlyMap<string, JsonValue>
  readonly now: number
}

/** A named predicate. */
export type ConditionPredicate = (input: ConditionInput) => boolean

function keyArg(args: JsonObject): string {
  const key = args['key']
  if (typeof key !== 'string') throw new GameAgentError('condition requires a string "key" argument', 'INVALID_CONDITION_ARGS')
  return key
}

/** Registry of predicates available to condition nodes. */
export class ConditionRegistry {
  private readonly predicates = new Map<string, ConditionPredicate>()

  /** Create a registry pre-loaded with the built-in predicates. */
  static withBuiltins(): ConditionRegistry {
    const registry = new ConditionRegistry()
    registry.register('always', () => true)
    registry.register('blackboard.exists', ({ args, blackboard }) => blackboard.has(keyArg(args)))
    registry.register('blackboard.equals', ({ args, blackboard }) => JSON.stringify(blackboard.get(keyArg(args))) === JSON.stringify(args['value']))
    registry.register('blackboard.atLeast', ({ args, blackboard }) => {
      const value = blackboard.get(keyArg(args))
      const threshold = args['value']
      return typeof value === 'number' && typeof threshold === 'number' && value >= threshold
    })
    registry.register('blackboard.atLeastKey', ({ args, blackboard }) => {
      const minKey = args['minKey']
      if (typeof minKey !== 'string') throw new GameAgentError('condition requires a string "minKey" argument', 'INVALID_CONDITION_ARGS')
      const value = blackboard.get(keyArg(args))
      const minimum = blackboard.get(minKey)
      return typeof value === 'number' && typeof minimum === 'number' && value >= minimum
    })
    return registry
  }

  /**
   * Add a predicate.
   * @returns a function that removes it again.
   * @throws GameAgentError `DUPLICATE_CONDITION` when the name is taken.
   */
  register(name: string, predicate: ConditionPredicate): () => void {
    if (this.predicates.has(name)) throw new GameAgentError(`Condition ${name} is already registered`, 'DUPLICATE_CONDITION')
    this.predicates.set(name, predicate)
    return () => {
      this.predicates.delete(name)
    }
  }

  /** Look up a predicate. */
  get(name: string): ConditionPredicate | undefined {
    return this.predicates.get(name)
  }

  /** Every registered name, for validation catalogs. */
  names(): ReadonlySet<string> {
    return new Set(this.predicates.keys())
  }
}
