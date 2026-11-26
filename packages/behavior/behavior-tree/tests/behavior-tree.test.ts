/**
 * Responsibilities: Verify tree validation, immutable editing, schedule arithmetic, and runner semantics for every node family.
 * Contracts: Drives the runner through a scripted in-test `TreeHost` whose handles resolve on demand.
 * Constraints: Deterministic; time is a plain counter controlled by the test.
 */
import { describe, expect, it } from 'vitest'
import type { JsonObject } from '@game-agent/contracts'
import {
  ConditionRegistry,
  TREE_FORMAT,
  TreeRunner,
  insertChild,
  isWithinWindows,
  listNodes,
  nextWindowBoundary,
  removeNode,
  replaceNode,
  validateTreeDefinition,
  type DecisionSpec,
  type HandleStatus,
  type LeafOutcome,
  type TreeDefinition,
  type TreeHost,
} from '../src/index.ts'

class ScriptedHost implements TreeHost {
  time = 0
  cursor = 0
  readonly events: { cursor: number; type: string }[] = []
  readonly started: { kind: 'action' | 'decision'; name: string; args?: JsonObject; handle: string }[] = []
  private readonly statuses = new Map<string, HandleStatus>()

  now(): number {
    return this.time
  }
  startAction(action: string, args: JsonObject): string {
    const handle = `h${this.started.length + 1}`
    this.started.push({ kind: 'action', name: action, args, handle })
    this.statuses.set(handle, { state: 'running' })
    return handle
  }
  startDecision(spec: DecisionSpec): string {
    const handle = `h${this.started.length + 1}`
    this.started.push({ kind: 'decision', name: spec.purpose, handle })
    this.statuses.set(handle, { state: 'running' })
    return handle
  }
  handleStatus(handle: string): HandleStatus {
    return this.statuses.get(handle) ?? { state: 'failed', reason: 'unknown handle' }
  }
  resolve(handle: string, status: HandleStatus): void {
    this.statuses.set(handle, status)
  }
  currentCursor(): number {
    return this.cursor
  }
  countEventsAfter(cursor: number, eventType: string): number {
    return this.events.filter((event) => event.cursor > cursor && event.type === eventType).length
  }
  pushEvent(type: string): void {
    this.cursor += 1
    this.events.push({ cursor: this.cursor, type })
  }
}

function tree(root: TreeDefinition['root']): TreeDefinition {
  return { format: TREE_FORMAT, id: 'test', version: 1, root }
}

describe('validateTreeDefinition', () => {
  it('accepts a well-formed tree and checks references against catalogs', () => {
    const definition = tree({
      type: 'selector',
      children: [
        { type: 'condition', check: 'always' },
        { type: 'decision', purpose: 'pick a target', tools: ['march'], maxProposals: 1, timeoutMs: 1000 },
      ],
    })
    expect(validateTreeDefinition(definition).ok).toBe(true)
    const withCatalogs = validateTreeDefinition(definition, { conditions: new Set(['always']), actions: new Set(['scout']) })
    expect(withCatalogs).toEqual({ ok: false, problems: [{ path: 'root/1', message: 'unknown tool march' }] })
  })

  it('reports every structural problem with its path', () => {
    const result = validateTreeDefinition({
      format: 'other',
      id: '',
      version: 0,
      root: { type: 'parallel', successThreshold: 3, children: [{ type: 'mystery' }, { type: 'cooldown', ms: -1, child: { type: 'set', key: 'k' } }] },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toEqual([
      { path: '$.format', message: 'format must be game-agent.tree/v1' },
      { path: '$.id', message: 'id must be a non-empty string' },
      { path: '$.version', message: 'version must be a positive integer' },
      { path: 'root/0', message: 'unknown node type "mystery"' },
      { path: 'root/1', message: 'ms must be a positive integer' },
      { path: 'root/1/0', message: 'value is required' },
      { path: 'root', message: 'successThreshold must be an integer between 1 and the number of children' },
    ])
  })
})

describe('tree editing', () => {
  it('returns new versions without mutating the input', () => {
    const original = tree({ type: 'sequence', children: [{ type: 'set', key: 'a', value: 1 }] })
    const inserted = insertChild(original, 'root', 1, { type: 'set', key: 'b', value: 2 })
    const replaced = replaceNode(inserted, 'root/0', { type: 'condition', check: 'always' })
    const removed = removeNode(replaced, 'root/1')
    expect(original.version).toBe(1)
    expect(removed.version).toBe(4)
    expect(listNodes(removed).map((item) => `${item.path}:${item.node.type}`)).toEqual(['root:sequence', 'root/0:condition'])
    expect(() => removeNode(original, 'root')).toThrowError(/root node cannot be removed/)
  })
})

describe('schedule windows', () => {
  it('handles windows that cross midnight and reports the next boundary', () => {
    const windows = [{ start: '22:00', end: '02:00' }]
    const at = (hours: number, minutes = 0): number => (hours * 60 + minutes) * 60_000
    expect(isWithinWindows(at(23), windows, 0)).toBe(true)
    expect(isWithinWindows(at(1, 59), windows, 0)).toBe(true)
    expect(isWithinWindows(at(12), windows, 0)).toBe(false)
    expect(nextWindowBoundary(at(12), windows, 0)).toBe(at(22))
    expect(isWithinWindows(at(14), windows, 480)).toBe(true)
  })
})

describe('TreeRunner', () => {
  it('keeps a running action across ticks and stores its outcome', () => {
    const host = new ScriptedHost()
    const runner = new TreeRunner(
      tree({
        type: 'sequence',
        children: [
          { type: 'set', key: 'target', value: 'camp-3' },
          { type: 'action', action: 'march', args: { target: { $blackboard: 'target' } }, store: 'loot' },
        ],
      }),
      host,
      ConditionRegistry.withBuiltins(),
    )
    expect(runner.tick().status).toBe('running')
    expect(runner.tick().status).toBe('running')
    expect(host.started).toEqual([{ kind: 'action', name: 'march', args: { target: 'camp-3' }, handle: 'h1' }])
    host.resolve('h1', { state: 'succeeded', output: { food: 40 } })
    expect(runner.tick().status).toBe('success')
    expect(runner.blackboard.get('loot')).toEqual({ food: 40 })
  })

  it('falls back to the AI node only when rule branches fail', () => {
    const host = new ScriptedHost()
    const leaves: LeafOutcome[] = []
    const runner = new TreeRunner(
      tree({
        type: 'selector',
        children: [
          { type: 'condition', check: 'blackboard.atLeast', args: { key: 'food', value: 100 } },
          { type: 'decision', purpose: 'raise food', tools: ['gather'], maxProposals: 1, timeoutMs: 5000, store: 'plan' },
        ],
      }),
      host,
      ConditionRegistry.withBuiltins(),
      (outcome) => leaves.push(outcome),
    )
    runner.blackboard.set('food', 150)
    expect(runner.tick().status).toBe('success')
    expect(host.started).toHaveLength(0)

    runner.blackboard.set('food', 10)
    expect(runner.tick().status).toBe('running')
    host.resolve('h1', { state: 'failed', reason: 'model abstained' })
    expect(runner.tick().status).toBe('failure')
    expect(leaves.map((leaf) => `${leaf.path}:${leaf.status}`)).toEqual(['root/0:success', 'root/0:failure', 'root/1:failure'])
    expect(leaves.at(-1)?.reason).toBe('model abstained')
  })

  it('blocks a cooled-down branch and reports when to wake', () => {
    const host = new ScriptedHost()
    const runner = new TreeRunner(tree({ type: 'cooldown', ms: 60_000, child: { type: 'set', key: 'x', value: 1 } }), host, ConditionRegistry.withBuiltins())
    expect(runner.tick().status).toBe('success')
    host.time = 30_000
    expect(runner.tick()).toMatchObject({ status: 'failure', wakeAt: 60_000 })
    host.time = 60_000
    expect(runner.tick().status).toBe('success')
  })

  it('waits for an inbox event or times out', () => {
    const host = new ScriptedHost()
    const runner = new TreeRunner(tree({ type: 'wait-event', eventType: 'attacked', timeoutMs: 1000 }), host, ConditionRegistry.withBuiltins())
    expect(runner.tick()).toMatchObject({ status: 'running', wakeAt: 1000 })
    host.pushEvent('chat')
    expect(runner.tick().status).toBe('running')
    host.pushEvent('attacked')
    expect(runner.tick().status).toBe('success')
    expect(runner.tick().status).toBe('running')
    host.time = 2000
    expect(runner.tick().status).toBe('failure')
  })

  it('succeeds a parallel node once the threshold is met', () => {
    const host = new ScriptedHost()
    const runner = new TreeRunner(
      tree({
        type: 'parallel',
        successThreshold: 1,
        children: [
          { type: 'action', action: 'gather', args: {} },
          { type: 'action', action: 'train', args: {} },
        ],
      }),
      host,
      ConditionRegistry.withBuiltins(),
    )
    expect(runner.tick().status).toBe('running')
    host.resolve('h2', { state: 'succeeded' })
    expect(runner.tick().status).toBe('success')
    expect(host.started.map((item) => item.name)).toEqual(['gather', 'train'])
  })

  it('fails an action whose blackboard reference is missing', () => {
    const host = new ScriptedHost()
    const leaves: LeafOutcome[] = []
    const runner = new TreeRunner(
      tree({ type: 'action', action: 'march', args: { target: { $blackboard: 'target' } } }),
      host,
      ConditionRegistry.withBuiltins(),
      (outcome) => leaves.push(outcome),
    )
    expect(runner.tick().status).toBe('failure')
    expect(leaves[0]?.reason).toBe('blackboard key target is not set')
    expect(host.started).toHaveLength(0)
  })
})
