/**
 * Responsibilities: Define the editable JSON format of a behavior tree and the addressing scheme for its nodes.
 * Contracts: A definition is plain JSON, versioned, and fully described by these types; node paths are stable for a given definition.
 * Constraints: Type and constant module only; validation lives in `validate.ts`, execution in `runner.ts`.
 */
import type { JsonObject, JsonValue } from '@game-agent/contracts'

/** Format tag carried by every definition. */
export const TREE_FORMAT = 'game-agent.tree/v1'

/** Daily time window in `HH:MM`; `end` earlier than `start` crosses midnight. */
export interface TimeWindow {
  readonly start: string
  readonly end: string
}

interface NodeBase {
  /** Optional label shown in editors and traces. */
  readonly name?: string
}

/** Runs children in order until one fails. */
export interface SequenceNode extends NodeBase {
  readonly type: 'sequence'
  readonly children: readonly NodeDefinition[]
}

/** Runs children in order until one succeeds. */
export interface SelectorNode extends NodeBase {
  readonly type: 'selector'
  readonly children: readonly NodeDefinition[]
}

/** Runs all children each tick; succeeds once `successThreshold` children succeed. */
export interface ParallelNode extends NodeBase {
  readonly type: 'parallel'
  readonly successThreshold: number
  readonly children: readonly NodeDefinition[]
}

/** Swaps success and failure of its child. */
export interface InverterNode extends NodeBase {
  readonly type: 'inverter'
  readonly child: NodeDefinition
}

/** Fails for `ms` after its child last succeeded. */
export interface CooldownNode extends NodeBase {
  readonly type: 'cooldown'
  readonly ms: number
  readonly child: NodeDefinition
}

/** Runs its child only inside the given daily windows (the agent's active hours). */
export interface ScheduleNode extends NodeBase {
  readonly type: 'schedule'
  readonly windows: readonly TimeWindow[]
  readonly utcOffsetMinutes: number
  readonly child: NodeDefinition
}

/** Evaluates a registered predicate. */
export interface ConditionNode extends NodeBase {
  readonly type: 'condition'
  readonly check: string
  readonly args?: JsonObject
}

/** Issues one game command and waits for its settlement. `{ "$blackboard": "key" }` in args reads the blackboard. */
export interface ActionNode extends NodeBase {
  readonly type: 'action'
  readonly action: string
  readonly args?: JsonObject
  /** Blackboard key receiving the settled outcome. */
  readonly store?: string
}

/** AI node: one bounded model decision restricted to `tools`. */
export interface DecisionNode extends NodeBase {
  readonly type: 'decision'
  readonly purpose: string
  readonly tools: readonly string[]
  readonly maxProposals: number
  readonly timeoutMs: number
  /** Blackboard key receiving the decision summary. */
  readonly store?: string
}

/** Waits until an inbox event of `eventType` arrives or `timeoutMs` passes. */
export interface WaitEventNode extends NodeBase {
  readonly type: 'wait-event'
  readonly eventType: string
  readonly timeoutMs: number
}

/** Writes a value to the blackboard and succeeds. */
export interface SetNode extends NodeBase {
  readonly type: 'set'
  readonly key: string
  readonly value: JsonValue
}

export type NodeDefinition =
  | SequenceNode
  | SelectorNode
  | ParallelNode
  | InverterNode
  | CooldownNode
  | ScheduleNode
  | ConditionNode
  | ActionNode
  | DecisionNode
  | WaitEventNode
  | SetNode

/** Every node type name. */
export const NODE_TYPES = [
  'sequence',
  'selector',
  'parallel',
  'inverter',
  'cooldown',
  'schedule',
  'condition',
  'action',
  'decision',
  'wait-event',
  'set',
] as const satisfies readonly NodeDefinition['type'][]

/** A complete, versioned behavior tree. */
export interface TreeDefinition {
  readonly format: typeof TREE_FORMAT
  readonly id: string
  readonly version: number
  readonly title?: string
  readonly description?: string
  readonly root: NodeDefinition
}

/** Children of a node in evaluation order; decorators have exactly one. */
export function childrenOf(node: NodeDefinition): readonly NodeDefinition[] {
  switch (node.type) {
    case 'sequence':
    case 'selector':
    case 'parallel':
      return node.children
    case 'inverter':
    case 'cooldown':
    case 'schedule':
      return [node.child]
    default:
      return []
  }
}

/** Path of the root node. */
export const ROOT_PATH = 'root'

/** Path of the child at `index` under `parent`. */
export function childPath(parent: string, index: number): string {
  return `${parent}/${index}`
}
