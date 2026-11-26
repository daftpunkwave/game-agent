/**
 * Responsibilities: Verify scheduler pacing and fault backoff, and that the Cordis host service starts, lists, and stops agents.
 * Contracts: Scheduler tests use a manual timer queue; the host test uses the simulated game with real Cordis composition.
 * Constraints: No real timers are left running after a test.
 */
import { describe, expect, it } from 'vitest'
import { TREE_FORMAT } from '@game-agent/behavior-tree'
import { ManualClock, SeededRng, SequentialIds } from '@game-agent/ports'
import { MemoryTraceSink } from '@game-agent/trace'
import { SimulatedGameTransport } from '@game-agent/transport-simulated'
import { AgentScheduler, GameAgentHost, createAppContext, type SchedulableAgent, type TimerPort } from '../src/index.ts'

class ManualTimers implements TimerPort {
  readonly queue: { callback: () => void; delay: number; handle: number }[] = []
  private next = 0
  set(callback: () => void, delay: number): unknown {
    this.next += 1
    this.queue.push({ callback, delay, handle: this.next })
    return this.next
  }
  clear(handle: unknown): void {
    const index = this.queue.findIndex((item) => item.handle === handle)
    if (index >= 0) this.queue.splice(index, 1)
  }
  async fire(): Promise<number> {
    const item = this.queue.shift()
    if (item === undefined) throw new Error('no timer queued')
    item.callback()
    await new Promise((resolve) => setImmediate(resolve))
    return item.delay
  }
}

describe('AgentScheduler', () => {
  it('steps immediately, then at the earlier of wakeAt and heartbeat, and backs off on faults', async () => {
    const clock = new ManualClock(0)
    const timers = new ManualTimers()
    const outcomes: (() => Promise<{ wakeAt?: number }>)[] = [
      async () => ({ wakeAt: 5_000 }),
      async () => {
        throw new Error('socket reset')
      },
      async () => {
        throw new Error('socket reset')
      },
      async () => ({}),
    ]
    const faults: number[] = []
    const agent: SchedulableAgent = { step: () => (outcomes.shift() as () => Promise<{ wakeAt?: number }>)(), onWake: () => () => {} }
    const scheduler = new AgentScheduler(agent, { clock, timers, heartbeatMs: 60_000, initialBackoffMs: 1_000, maxBackoffMs: 10_000, onFault: (_error, count) => faults.push(count) })
    scheduler.start()
    expect(await timers.fire()).toBe(0)
    expect(await timers.fire()).toBe(5_000)
    expect(await timers.fire()).toBe(1_000)
    expect(await timers.fire()).toBe(2_000)
    expect(timers.queue[0]?.delay).toBe(60_000)
    expect(faults).toEqual([1, 2])
    expect(scheduler.consecutiveFailures).toBe(0)
    scheduler.stop()
    expect(timers.queue).toHaveLength(0)
  })
})

describe('GameAgentHost', () => {
  it('hosts agents as a Cordis service and stops them on demand', async () => {
    const ctx = createAppContext()
    const clock = new ManualClock(0)
    const timers = new ManualTimers()
    await ctx.plugin(GameAgentHost, { clock, timers })
    const transport = new SimulatedGameTransport({ clock, agents: ['a1'], upgradeDurationMs: 1_000 })
    await ctx.gameAgents.spawn({
      agentId: 'a1',
      transport,
      tree: { format: TREE_FORMAT, id: 't', version: 1, root: { type: 'action', action: 'gather', args: { resource: 'food' } } },
      visibility: { views: { city: { fields: [{ path: 'food' }] } }, events: {}, budget: { maxStringLength: 100, maxArrayItems: 10, maxFieldsPerView: 10 } },
      quota: {},
      jitter: { minMs: 0, maxMs: 0 },
      clock,
      rng: new SeededRng(1),
      ids: new SequentialIds(),
      delay: async () => {},
      trace: new MemoryTraceSink(50),
    })
    expect(ctx.gameAgents.list().map((status) => `${status.agentId}:${status.connected}`)).toEqual(['a1:true'])
    await timers.fire()
    await ctx.gameAgents.get('a1')?.settle()
    expect(ctx.gameAgents.get('a1')?.blackboard.get('city.food')).toBe(50)
    await ctx.gameAgents.stop('a1')
    expect(ctx.gameAgents.list()).toEqual([])
  })
})
