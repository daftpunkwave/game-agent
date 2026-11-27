/**
 * Responsibilities: Hold processed events for one agent behind a monotonic cursor so consumers can resume exactly where they stopped.
 * Contracts: `append` drops duplicates by event id; `readAfter` never returns an entry twice for the same cursor; overflow drops the oldest entry and is counted.
 * Constraints: Bounded memory: capacity limits stored entries and `dedupeWindow` limits remembered event ids. Persistence is the caller's concern.
 */
import type { AgentEvent } from '@game-agent/contracts'
import { Deque } from '@game-agent/deque'

/** One stored event and its position. */
export interface InboxEntry {
  readonly cursor: number
  readonly event: AgentEvent
}

/** Sizing for one inbox. */
export interface InboxOptions {
  /** Maximum number of unacknowledged entries kept. */
  readonly capacity: number
  /** Number of recent event ids remembered for duplicate detection. */
  readonly dedupeWindow: number
}

/** Cursor-addressed event inbox for one agent. */
export class EventInbox {
  /** Retained entries in ascending cursor order. */
  private readonly entries: InboxEntry[] = []
  private readonly recentIds = new Deque<string>()
  private readonly recentIdSet = new Set<string>()
  private nextCursor = 1
  private droppedCount = 0
  private readonly options: InboxOptions

  constructor(options: InboxOptions) {
    this.options = options
  }

  /** Cursor of the newest appended entry, or 0 when nothing was appended yet. */
  get lastCursor(): number {
    return this.nextCursor - 1
  }

  /** Number of entries currently retained. */
  get size(): number {
    return this.entries.length
  }

  /** Number of entries discarded because the inbox was full. */
  get dropped(): number {
    return this.droppedCount
  }

  /**
   * Store one event.
   * @returns the stored entry, or `undefined` when the event id was seen recently.
   */
  append(event: AgentEvent): InboxEntry | undefined {
    if (this.recentIdSet.has(event.eventId)) return undefined
    this.remember(event.eventId)
    const entry: InboxEntry = { cursor: this.nextCursor, event }
    this.nextCursor += 1
    this.entries.push(entry)
    if (this.entries.length > this.options.capacity) {
      this.entries.shift()
      this.droppedCount += 1
    }
    return entry
  }

  /**
   * Read entries newer than `cursor`, oldest first.
   * @param cursor - last cursor the caller has already processed.
   * @param limit - maximum number of entries returned.
   */
  readAfter(cursor: number, limit = Number.POSITIVE_INFINITY): InboxEntry[] {
    const result: InboxEntry[] = []
    for (const entry of this.entries) {
      if (entry.cursor <= cursor) continue
      if (result.length >= limit) break
      result.push(entry)
    }
    return result
  }

  /** Release every entry at or before `cursor`. */
  acknowledge(cursor: number): void {
    let released = 0
    while (released < this.entries.length && (this.entries[released]?.cursor ?? Number.POSITIVE_INFINITY) <= cursor) released += 1
    this.entries.splice(0, released)
  }

  private remember(eventId: string): void {
    this.recentIds.pushBack(eventId)
    this.recentIdSet.add(eventId)
    if (this.recentIds.size > this.options.dedupeWindow) {
      const forgotten = this.recentIds.popFront()
      if (forgotten !== undefined) this.recentIdSet.delete(forgotten)
    }
  }
}
