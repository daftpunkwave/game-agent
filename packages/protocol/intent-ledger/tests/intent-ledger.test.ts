/**
 * Responsibilities: Verify intent settlement, overdue detection, reconciliation, and illegal transitions.
 * Contracts: Uses a ManualClock so every deadline is deterministic.
 * Constraints: Exercises only the public ledger API.
 */
import { describe, expect, it } from 'vitest'
import type { GameIntent, RawGameEvent } from '@game-agent/contracts'
import { ManualClock } from '@game-agent/ports'
import { IntentLedger } from '../src/index.ts'

function intent(intentId: string): GameIntent {
  return { intentId, agentId: 'a1', action: 'march', args: {}, source: 'tree', issuedAt: 0, idempotencyKey: `a1:${intentId}` }
}

function settleEvent(correlationId: string, settlement: 'succeeded' | 'failed'): RawGameEvent {
  return { eventId: `e-${correlationId}`, agentId: 'a1', type: 'march.finished', occurredAt: 0, correlationId, settlement, fields: { loot: 5 } }
}

function createLedger(clock: ManualClock): IntentLedger {
  return new IntentLedger({ clock, graceMs: 1_000, graceRatio: 0.1, defaultSettleMs: 60_000 })
}

describe('IntentLedger', () => {
  it('settles an accepted intent only through its correlation id', () => {
    const clock = new ManualClock(0)
    const ledger = createLedger(clock)
    ledger.record(intent('i1'))
    ledger.markSent('i1')
    ledger.applyReceipt('i1', { kind: 'accepted', correlationId: 'm-7', expectedSettleAt: 10_000 })

    expect(ledger.settleFromEvent(settleEvent('m-other', 'succeeded'))).toEqual({ kind: 'external' })
    const match = ledger.settleFromEvent(settleEvent('m-7', 'succeeded'))
    expect(match.kind).toBe('settled')
    expect(ledger.get('i1')?.state).toBe('succeeded')
    expect(ledger.get('i1')?.outcome).toEqual({ loot: 5 })
    expect(ledger.settleFromEvent(settleEvent('m-7', 'succeeded')).kind).toBe('duplicate')
  })

  it('marks overdue after the expected time plus grace and reconciles by query', () => {
    const clock = new ManualClock(0)
    const ledger = createLedger(clock)
    ledger.record(intent('i1'))
    ledger.markSent('i1')
    ledger.applyReceipt('i1', { kind: 'accepted', correlationId: 'm-1', expectedSettleAt: 20_000 })

    clock.advance(22_000)
    expect(ledger.collectOverdue()).toHaveLength(0)
    clock.advance(1)
    const overdue = ledger.collectOverdue()
    expect(overdue.map((entry) => entry.intent.intentId)).toEqual(['i1'])
    expect(ledger.get('i1')?.state).toBe('overdue')

    ledger.resolveReconciliation('i1', { kind: 'pending', expectedSettleAt: 30_000 })
    expect(ledger.get('i1')?.state).toBe('accepted')
    ledger.resolveReconciliation('i1', { kind: 'failed', reason: 'target moved' })
    expect(ledger.get('i1')?.state).toBe('failed')
    expect(ledger.open()).toHaveLength(0)
  })

  it('keeps an in-doubt send distinct from a failure and rejects illegal transitions', () => {
    const clock = new ManualClock(0)
    const ledger = createLedger(clock)
    ledger.record(intent('i1'))
    ledger.markSent('i1')
    ledger.markInDoubt('i1', 'socket closed')
    expect(ledger.get('i1')?.state).toBe('in-doubt')
    expect(() => ledger.applyReceipt('i1', { kind: 'accepted', correlationId: 'x' })).toThrowError(/cannot move from in-doubt/)
    ledger.resolveReconciliation('i1', { kind: 'unknown' })
    expect(ledger.get('i1')?.state).toBe('unknown')
  })

  it('refuses to record the same intent twice', () => {
    const ledger = createLedger(new ManualClock(0))
    ledger.record(intent('i1'))
    expect(() => ledger.record(intent('i1'))).toThrowError(/already recorded/)
  })
})
