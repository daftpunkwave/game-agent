/**
 * Responsibilities: Execute a behavior tree one tick at a time on the agent side, tracking long-running actions and decisions through host handles.
 * Contracts: `tick` is synchronous and deterministic for a given host; asynchronous work is started through the host and polled by handle; `wakeAt` reports the next time-driven change so callers never busy-poll.
 * Constraints: The runner never talks to a game or a model directly; it sees only the blackboard, the host, and registered conditions.
 */
import { isJsonObject, type JsonObject, type JsonValue } from '@game-agent/contracts'
import { GameAgentError } from '@game-agent/errors'
import type { ConditionRegistry } from './conditions.ts'
import { ROOT_PATH, childPath, type NodeDefinition, type TreeDefinition } from './definition.ts'
import { isWithinWindows, nextWindowBoundary } from './schedule.ts'

/** Result of evaluating one node. */
export type NodeStatus = 'success' | 'failure' | 'running'

/** Progress of asynchronous work started by an action or decision node. */
export type HandleStatus =
  | { readonly state: 'running' }
  | { readonly state: 'succeeded'; readonly output?: JsonValue }
  | { readonly state: 'failed'; readonly reason: string }

/** Parameters of one AI decision requested by a decision node. */
export interface DecisionSpec {
  readonly purpose: string
  readonly tools: readonly string[]
  readonly maxProposals: number
  readonly timeoutMs: number
}

/** Services the runner needs from the agent runtime. */
export interface TreeHost {
  now(): number
  /** Start a game command; returns a handle polled through `handleStatus`. */
  startAction(action: string, args: JsonObject, nodePath: string): string
  /** Start a bounded model decision; returns a handle polled through `handleStatus`. */
  startDecision(spec: DecisionSpec, nodePath: string): string
  handleStatus(handle: string): HandleStatus
  /** Cursor of the newest inbox event. */
  currentCursor(): number
  /** Number of inbox events of `eventType` newer than `cursor`. */
  countEventsAfter(cursor: number, eventType: string): number
}

/** Completion of a leaf node, reported for monitoring. */
export interface LeafOutcome {
  readonly path: string
  readonly node: NodeDefinition
  readonly status: Exclude<NodeStatus, 'running'>
  readonly reason?: string
}

/** Result of one tick. */
export interface TickResult {
  readonly status: NodeStatus
  /** Earliest time at which a timer-driven node may change its outcome. */
  readonly wakeAt?: number
  readonly visited: number
}

type NodeState =
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'parallel'; readonly results: readonly (NodeStatus | undefined)[] }
  | { readonly kind: 'handle'; readonly handle: string }
  | { readonly kind: 'wait'; readonly sinceCursor: number; readonly deadline: number }

const BLACKBOARD_REFERENCE = '$blackboard'

/** Agent-side behavior tree executor. */
export class TreeRunner {
  /** Shared memory of the tree; survives tree replacement. */
  readonly blackboard = new Map<string, JsonValue>()
  private tree: TreeDefinition
  private readonly host: TreeHost
  private readonly conditions: ConditionRegistry
  private readonly onLeaf: ((outcome: LeafOutcome) => void) | undefined
  private readonly states = new Map<string, NodeState>()
  private readonly cooldowns = new Map<string, number>()
  private wakeAt: number | undefined
  private visited = 0

  constructor(tree: TreeDefinition, host: TreeHost, conditions: ConditionRegistry, onLeaf?: (outcome: LeafOutcome) => void) {
    this.tree = tree
    this.host = host
    this.conditions = conditions
    this.onLeaf = onLeaf
  }

  /** Definition currently executed. */
  get definition(): TreeDefinition {
    return this.tree
  }

  /** Evaluate the tree once from the root. */
  tick(): TickResult {
    this.wakeAt = undefined
    this.visited = 0
    const status = this.evaluate(this.tree.root, ROOT_PATH)
    if (status !== 'running') this.states.clear()
    return { status, visited: this.visited, ...(this.wakeAt === undefined ? {} : { wakeAt: this.wakeAt }) }
  }

  /**
   * Swap in an edited tree. Running node state and cooldowns are discarded because node paths may have changed;
   * commands already sent stay tracked by the intent ledger.
   */
  replaceTree(tree: TreeDefinition): void {
    this.tree = tree
    this.states.clear()
    this.cooldowns.clear()
  }

  private evaluate(node: NodeDefinition, path: string): NodeStatus {
    this.visited += 1
    switch (node.type) {
      case 'sequence':
        return this.evaluateOrdered(node.children, path, 'failure')
      case 'selector':
        return this.evaluateOrdered(node.children, path, 'success')
      case 'parallel':
        return this.evaluateParallel(node.children, node.successThreshold, path)
      case 'inverter': {
        const status = this.evaluate(node.child, childPath(path, 0))
        return status === 'running' ? status : status === 'success' ? 'failure' : 'success'
      }
      case 'cooldown': {
        const readyAt = this.cooldowns.get(path)
        const now = this.host.now()
        if (readyAt !== undefined && now < readyAt) {
          this.noteWake(readyAt)
          return 'failure'
        }
        const status = this.evaluate(node.child, childPath(path, 0))
        if (status === 'success') this.cooldowns.set(path, now + node.ms)
        return status
      }
      case 'schedule': {
        const now = this.host.now()
        this.noteWake(nextWindowBoundary(now, node.windows, node.utcOffsetMinutes))
        if (isWithinWindows(now, node.windows, node.utcOffsetMinutes)) return this.evaluate(node.child, childPath(path, 0))
        this.clearSubtree(childPath(path, 0))
        return 'failure'
      }
      case 'condition':
        return this.evaluateCondition(node.check, node.args ?? {}, node, path)
      case 'action':
        return this.evaluateHandle(node, path, node.store, () => this.host.startAction(node.action, this.resolveArgs(node.args ?? {}), path))
      case 'decision':
        return this.evaluateHandle(node, path, node.store, () =>
          this.host.startDecision({ purpose: node.purpose, tools: node.tools, maxProposals: node.maxProposals, timeoutMs: node.timeoutMs }, path),
        )
      case 'wait-event':
        return this.evaluateWait(node.eventType, node.timeoutMs, node, path)
      case 'set':
        this.blackboard.set(node.key, structuredClone(node.value))
        return 'success'
    }
  }

  private evaluateOrdered(children: readonly NodeDefinition[], path: string, stopOn: 'success' | 'failure'): NodeStatus {
    const state = this.states.get(path)
    const start = state?.kind === 'index' ? state.index : 0
    for (let index = start; index < children.length; index += 1) {
      const status = this.evaluate(children[index] as NodeDefinition, childPath(path, index))
      if (status === 'running') {
        this.states.set(path, { kind: 'index', index })
        return 'running'
      }
      if (status === stopOn) {
        this.clearSubtree(path)
        return stopOn
      }
    }
    this.clearSubtree(path)
    return stopOn === 'failure' ? 'success' : 'failure'
  }

  private evaluateParallel(children: readonly NodeDefinition[], threshold: number, path: string): NodeStatus {
    const state = this.states.get(path)
    const results = state?.kind === 'parallel' ? [...state.results] : children.map(() => undefined)
    children.forEach((child, index) => {
      if (results[index] === undefined || results[index] === 'running') results[index] = this.evaluate(child, childPath(path, index))
    })
    const successes = results.filter((status) => status === 'success').length
    const failures = results.filter((status) => status === 'failure').length
    if (successes >= threshold || failures > children.length - threshold) {
      this.clearSubtree(path)
      return successes >= threshold ? 'success' : 'failure'
    }
    this.states.set(path, { kind: 'parallel', results })
    return 'running'
  }

  private evaluateCondition(check: string, args: JsonObject, node: NodeDefinition, path: string): NodeStatus {
    const predicate = this.conditions.get(check)
    if (predicate === undefined) return this.finishLeaf(node, path, 'failure', `unknown condition ${check}`)
    try {
      const passed = predicate({ args, blackboard: this.blackboard, now: this.host.now() })
      return this.finishLeaf(node, path, passed ? 'success' : 'failure')
    } catch (error) {
      return this.finishLeaf(node, path, 'failure', error instanceof Error ? error.message : String(error))
    }
  }

  private evaluateHandle(node: NodeDefinition, path: string, store: string | undefined, start: () => string): NodeStatus {
    let state = this.states.get(path)
    if (state?.kind !== 'handle') {
      try {
        state = { kind: 'handle', handle: start() }
      } catch (error) {
        return this.finishLeaf(node, path, 'failure', error instanceof Error ? error.message : String(error))
      }
      this.states.set(path, state)
    }
    const status = this.host.handleStatus(state.handle)
    if (status.state === 'running') return 'running'
    this.states.delete(path)
    if (status.state === 'failed') return this.finishLeaf(node, path, 'failure', status.reason)
    if (store !== undefined) this.blackboard.set(store, status.output ?? null)
    return this.finishLeaf(node, path, 'success')
  }

  private evaluateWait(eventType: string, timeoutMs: number, node: NodeDefinition, path: string): NodeStatus {
    let state = this.states.get(path)
    if (state?.kind !== 'wait') {
      state = { kind: 'wait', sinceCursor: this.host.currentCursor(), deadline: this.host.now() + timeoutMs }
      this.states.set(path, state)
    }
    if (this.host.countEventsAfter(state.sinceCursor, eventType) > 0) {
      this.states.delete(path)
      return this.finishLeaf(node, path, 'success')
    }
    if (this.host.now() >= state.deadline) {
      this.states.delete(path)
      return this.finishLeaf(node, path, 'failure', `no ${eventType} event before timeout`)
    }
    this.noteWake(state.deadline)
    return 'running'
  }

  private finishLeaf(node: NodeDefinition, path: string, status: 'success' | 'failure', reason?: string): NodeStatus {
    this.onLeaf?.({ path, node, status, ...(reason === undefined ? {} : { reason }) })
    return status
  }

  private resolveArgs(args: JsonObject): JsonObject {
    const resolve = (value: JsonValue): JsonValue => {
      if (Array.isArray(value)) return value.map(resolve)
      if (!isJsonObject(value)) return value
      const reference = value[BLACKBOARD_REFERENCE]
      if (typeof reference === 'string' && Object.keys(value).length === 1) {
        const stored = this.blackboard.get(reference)
        if (stored === undefined) throw new GameAgentError(`blackboard key ${reference} is not set`, 'MISSING_BLACKBOARD_KEY')
        return structuredClone(stored)
      }
      const result: JsonObject = {}
      for (const [key, item] of Object.entries(value)) result[key] = resolve(item)
      return result
    }
    return resolve(args) as JsonObject
  }

  private clearSubtree(path: string): void {
    for (const key of [...this.states.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.states.delete(key)
    }
  }

  private noteWake(at: number): void {
    if (this.wakeAt === undefined || at < this.wakeAt) this.wakeAt = at
  }
}
