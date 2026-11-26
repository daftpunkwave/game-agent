/**
 * Responsibilities: Define the side-effect ports (time, randomness, identifiers) that core algorithms receive by injection.
 * Contracts: Production implementations read the system; manual implementations are fully deterministic for tests and simulations.
 * Constraints: Core packages must obtain time, randomness, and identifiers only through these ports, never from globals.
 */
import { randomUUID } from 'node:crypto'

/** Source of the current time in epoch milliseconds. */
export interface Clock {
  now(): number
}

/** Source of uniformly distributed numbers in `[0, 1)`. */
export interface Rng {
  next(): number
}

/** Source of unique identifiers. */
export interface IdSource {
  next(prefix: string): string
}

/** Clock backed by `Date.now()`. */
export const systemClock: Clock = { now: () => Date.now() }

/** Random source backed by `Math.random()`. */
export const systemRng: Rng = { next: () => Math.random() }

/** Identifier source backed by random UUIDs. */
export const systemIds: IdSource = { next: (prefix) => `${prefix}_${randomUUID()}` }

/** Clock that only moves when told to; used by tests and accelerated simulations. */
export class ManualClock implements Clock {
  private current: number

  /** @param start - initial epoch milliseconds. */
  constructor(start = 0) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  /**
   * Move time forward.
   * @param milliseconds - non-negative duration to advance.
   * @throws RangeError when the duration is negative or not finite.
   */
  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError(`ManualClock cannot advance by ${milliseconds}`)
    }
    this.current += milliseconds
  }
}

/** Deterministic pseudo-random source (mulberry32) for reproducible simulations. */
export class SeededRng implements Rng {
  private state: number

  /** @param seed - 32-bit seed; equal seeds produce equal sequences. */
  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let value = this.state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Identifier source producing `prefix_1`, `prefix_2`, ... per prefix. */
export class SequentialIds implements IdSource {
  private readonly counters = new Map<string, number>()

  next(prefix: string): string {
    const value = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, value)
    return `${prefix}_${value}`
  }
}
