/**
 * Responsibilities: Verify the end-to-end agent loop against the simulated game: rule branches, accepted-then-settled commands, AI node proposals, and visibility of the blackboard mirror.
 * Contracts: Uses ManualClock, SeededRng, SequentialIds, ScriptedModelAdapter, and SimulatedGameTransport.
 * Constraints: Deterministic; `settle()` is awaited after each step so asynchronous work completes before assertions.
 */
import { describe, expect, it } from 'vitest'
import { TREE_FORMAT, type TreeDefinition } from '@game-agent/behavior-tree'
import { DecisionEngine, ScriptedModelAdapter } from '@game-agent/decision'
import type { VisibilityPolicy } from '@game-agent/gateway'
import { ManualClock, SeededRng, SequentialIds } from '@game-agent/ports'
import { MemoryTraceSink } from '@game-agent/trace'
import { SimulatedGameTransport } from '@game-agent/transport-simulated'
import { AgentRuntime } from '../src/index.ts'

const visibility: VisibilityPolicy = {
  views: { city: { fields: [{ path: 'food' }, { path: 'wood' }, { path: 'farmLevel' }, { path: 'upgrading' }] } },
  events: { 'farm.upgraded': { fields: [{ path: 'farmLevel' }], tags: ['spending'] } },
  budget: { maxStringLength: 200, maxArrayItems: 20, maxFieldsPerView: 20 },
}

const tree: TreeDefinition = {
  format: TREE_FORMAT,
  id: 'farm-loop',
  version: 1,
  root: {
    type: 'selector',
    children: [
      {
        type: 'sequence',
        name: 'upgrade when wood allows',
        children: [
          { type: 'condition', check: 'blackboard.equals', args: { key: 'city.upgrading', value: false } },
          { type: 'condition', check: 'blackboard.atLeast', args: { key: 'city.wood', value: 50 } },
          { type: 'action', action: 'upgrade_farm', args: {}, store: 'lastUpgrade' },
        ],
      },
      { type: 'decision', purpose: 'Decide what to gather next', tools: ['gather'], maxProposals: 1, timeoutMs: 5000 },
    ],
  },
}

function createRuntime(model?: ScriptedModelAdapter) {
  const clock = new ManualClock(0)
  const transport = new SimulatedGameTransport({ clock, agents: ['a1'], upgradeDurationMs: 60_000 })
  const trace = new MemoryTraceSink(500)
  const runtime = new AgentRuntime({
    agentId: 'a1',
    transport,
    tree,
    visibility,
    quota: { dailyTotal: 100 },
    jitter: { minMs: 0, maxMs: 0 },
    clock,
    rng: new SeededRng(7),
    ids: new SequentialIds(),
    delay: async () => {},
    trace,
    ...(model === undefined ? {} : { decision: new DecisionEngine({ model, gameRules: 'Simulated farm.', timeoutSignal: () => new AbortController().signal }) }),
  })
  return { clock, transport, trace, runtime }
}

describe('AgentRuntime', () => {
  it('mirrors only visible fields, then settles an accepted upgrade through the pushed event', async () => {
    const { clock, transport, runtime } = createRuntime()
    await runtime.start()
    expect(runtime.blackboard.get('city.wood')).toBe(60)
    expect([...runtime.blackboard.keys()].some((key) => key.startsWith('intel.'))).toBe(false)

    expect((await runtime.step()).status).toBe('running')
    await runtime.settle()
    expect(runtime.ledger.open().map((entry) => entry.state)).toEqual(['accepted'])
    expect((await runtime.step()).status).toBe('running')

    clock.advance(60_000)
    transport.advance()
    expect((await runtime.step()).status).toBe('success')
    expect(runtime.blackboard.get('lastUpgrade')).toEqual({ farmLevel: 2 })
    expect(runtime.status()).toMatchObject({ openIntents: 0, inbox: { size: 1 }, treeVersion: 1 })
  })

  it('falls back to the AI node and dispatches its validated proposal', async () => {
    const model = new ScriptedModelAdapter(() => ({
      text: 'Wood is short; gather wood.',
      toolCalls: [{ name: 'gather', arguments: { resource: 'wood' } }],
      malformedCalls: [],
      usage: { inputTokens: 800, outputTokens: 20, cachedInputTokens: 500 },
    }))
    const { clock, transport, runtime, trace } = createRuntime(model)
    await runtime.start()

    await runtime.step()
    await runtime.settle()
    clock.advance(60_000)
    transport.advance()
    expect((await runtime.step()).status).toBe('success')
    expect(runtime.blackboard.get('city.wood')).toBe(10)
    expect(model.requests).toHaveLength(0)

    expect((await runtime.step()).status).toBe('running')
    await runtime.settle()
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(['gather'])
    expect((await runtime.step()).status).toBe('success')
    expect(runtime.blackboard.get('city.wood')).toBe(35)
    expect(runtime.status().tokens).toEqual({ input: 800, output: 20, cachedInput: 500 })
    expect(trace.records().find((record) => record.name === 'decision.proposed')?.detail).toMatchObject({ proposals: ['gather'] })
  })

  it('reports a decision node failure when no model is configured', async () => {
    const { runtime, trace } = createRuntime()
    await runtime.start()
    runtime.replaceTree({ ...tree, version: 2, root: { type: 'decision', purpose: 'anything', tools: ['gather'], maxProposals: 1, timeoutMs: 1000 } })
    expect((await runtime.step()).status).toBe('failure')
    expect(runtime.status().decisions).toBe(0)
    expect(trace.records().some((record) => record.name === 'node.failure' && record.detail['reason'] === 'no model is configured for decision nodes')).toBe(true)
  })
})
