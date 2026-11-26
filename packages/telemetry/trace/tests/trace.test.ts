/**
 * Responsibilities: Verify trace filtering and bounded retention.
 * Contracts: Exercises only exported sinks and `filterTrace`.
 * Constraints: No filesystem access.
 */
import { describe, expect, it } from 'vitest'
import { MemoryTraceSink, filterTrace, type TraceRecord } from '../src/index.ts'

function record(at: number, category: TraceRecord['category'], tags: string[]): TraceRecord {
  return { at, agentId: at % 2 === 0 ? 'even' : 'odd', category, name: `r${at}`, tags, detail: {} }
}

describe('trace', () => {
  it('filters by category, tag, agent, and time range together', () => {
    const records = [record(1, 'intent', ['combat']), record(2, 'settlement', ['resource-gain']), record(3, 'settlement', ['combat'])]
    expect(filterTrace(records, { categories: ['settlement'] }).map((item) => item.name)).toEqual(['r2', 'r3'])
    expect(filterTrace(records, { tags: ['combat'], since: 2 }).map((item) => item.name)).toEqual(['r3'])
    expect(filterTrace(records, { agentId: 'even' }).map((item) => item.name)).toEqual(['r2'])
  })

  it('keeps only the newest records up to capacity', () => {
    const sink = new MemoryTraceSink(2)
    for (let at = 1; at <= 3; at += 1) sink.write(record(at, 'tick', []))
    expect(sink.records().map((item) => item.at)).toEqual([2, 3])
  })
})
