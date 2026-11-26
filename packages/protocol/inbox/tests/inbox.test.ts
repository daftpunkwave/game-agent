/**
 * Responsibilities: Verify cursor reads, duplicate suppression, acknowledgement, and overflow accounting.
 * Contracts: Exercises only the public `EventInbox` API.
 * Constraints: Deterministic; events are constructed inline.
 */
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@game-agent/contracts'
import { EventInbox } from '../src/index.ts'

function event(eventId: string): AgentEvent {
  return { eventId, agentId: 'a1', type: 'tick', occurredAt: 0, fields: {}, untrusted: [] }
}

describe('EventInbox', () => {
  it('returns entries after a cursor and suppresses duplicates', () => {
    const inbox = new EventInbox({ capacity: 10, dedupeWindow: 10 })
    inbox.append(event('e1'))
    expect(inbox.append(event('e1'))).toBeUndefined()
    inbox.append(event('e2'))
    expect(inbox.readAfter(0).map((entry) => entry.event.eventId)).toEqual(['e1', 'e2'])
    expect(inbox.readAfter(1).map((entry) => entry.cursor)).toEqual([2])
    inbox.acknowledge(1)
    expect(inbox.size).toBe(1)
    expect(inbox.lastCursor).toBe(2)
  })

  it('drops the oldest entry on overflow and counts it', () => {
    const inbox = new EventInbox({ capacity: 2, dedupeWindow: 10 })
    inbox.append(event('e1'))
    inbox.append(event('e2'))
    inbox.append(event('e3'))
    expect(inbox.dropped).toBe(1)
    expect(inbox.readAfter(0).map((entry) => entry.event.eventId)).toEqual(['e2', 'e3'])
  })
})
