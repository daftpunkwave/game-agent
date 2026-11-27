/**
 * Responsibilities: Define structured trace records and the sinks that retain them for monitoring, filtering, and replay.
 * Contracts: Every record names its agent, category, and tags; `filterTrace` selects records without mutating them.
 * Constraints: Sinks never throw into the caller's hot path; file output is append-only JSON Lines.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { JsonObject } from '@game-agent/contracts'

/** Coarse classification used by monitors and filters. */
export type TraceCategory = 'tick' | 'intent' | 'settlement' | 'ingress' | 'decision' | 'operator' | 'fault'

/** One observable step of an agent. */
export interface TraceRecord {
  readonly at: number
  readonly agentId: string
  readonly category: TraceCategory
  readonly name: string
  /** Game-defined labels such as `resource-gain`, `combat`, or `spending`. */
  readonly tags: readonly string[]
  readonly detail: JsonObject
}

/** Destination for trace records. */
export interface TraceSink {
  write(record: TraceRecord): void
}

/** Sink that discards every record. */
export const nullTraceSink: TraceSink = { write: () => {} }

/** Selection criteria for {@link filterTrace}. */
export interface TraceFilter {
  readonly agentId?: string
  readonly categories?: readonly TraceCategory[]
  readonly tags?: readonly string[]
  readonly since?: number
  readonly until?: number
}

/**
 * Select records matching every given criterion; a record matches `tags` when it carries at least one of them.
 * @returns matching records in their original order.
 */
export function filterTrace(records: Iterable<TraceRecord>, filter: TraceFilter): TraceRecord[] {
  const selected: TraceRecord[] = []
  for (const record of records) {
    if (filter.agentId !== undefined && record.agentId !== filter.agentId) continue
    if (filter.categories !== undefined && !filter.categories.includes(record.category)) continue
    if (filter.tags !== undefined && !record.tags.some((tag) => filter.tags?.includes(tag))) continue
    if (filter.since !== undefined && record.at < filter.since) continue
    if (filter.until !== undefined && record.at > filter.until) continue
    selected.push(record)
  }
  return selected
}

/** Bounded in-memory sink; the oldest records are discarded first. */
export class MemoryTraceSink implements TraceSink {
  private readonly buffer: TraceRecord[] = []
  private readonly capacity: number

  /** @param capacity - maximum number of retained records. */
  constructor(capacity: number) {
    this.capacity = capacity
  }

  write(record: TraceRecord): void {
    this.buffer.push(record)
    if (this.buffer.length > this.capacity) this.buffer.shift()
  }

  /** Retained records, oldest first. */
  records(): TraceRecord[] {
    return [...this.buffer]
  }
}

/** Append-only JSON Lines sink. Writes are serialized; failures are counted instead of thrown. */
export class JsonlTraceSink implements TraceSink {
  private pending: Promise<void> = Promise.resolve()
  private failureCount = 0
  private readonly path: string

  /** @param path - file receiving one JSON record per line. */
  constructor(path: string) {
    this.path = path
  }

  /** Number of records that could not be written. */
  get failures(): number {
    return this.failureCount
  }

  write(record: TraceRecord): void {
    const line = `${JSON.stringify(record)}\n`
    this.pending = this.pending
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true })
        await appendFile(this.path, line, 'utf8')
      })
      .catch(() => {
        this.failureCount += 1
      })
  }

  /** Resolve once every record written so far has reached the file (or failed). */
  flush(): Promise<void> {
    return this.pending
  }
}

/** Sink that forwards every record to several sinks. */
export class FanOutTraceSink implements TraceSink {
  private readonly sinks: readonly TraceSink[]

  constructor(sinks: readonly TraceSink[]) {
    this.sinks = sinks
  }

  write(record: TraceRecord): void {
    for (const sink of this.sinks) sink.write(record)
  }
}
