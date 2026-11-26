/**
 * Responsibilities: Verify ordering, wrap-around, and shrink behavior of the circular deque.
 * Contracts: Exercises only the public `Deque` API.
 * Constraints: Deterministic; no timers or randomness.
 */
import { describe, expect, it } from 'vitest'
import { Deque } from '../src/index.ts'

describe('Deque', () => {
  it('keeps FIFO order across growth and wrap-around', () => {
    const deque = new Deque<number>()
    for (let value = 0; value < 10; value += 1) deque.pushBack(value)
    for (let value = 0; value < 5; value += 1) expect(deque.popFront()).toBe(value)
    for (let value = 10; value < 40; value += 1) deque.pushBack(value)
    expect(deque.size).toBe(35)
    expect([...deque]).toEqual(Array.from({ length: 35 }, (_, index) => index + 5))
  })

  it('supports both ends and reports empty pops as undefined', () => {
    const deque = new Deque<string>()
    deque.pushBack('b')
    deque.pushFront('a')
    deque.pushBack('c')
    expect(deque.peekFront()).toBe('a')
    expect(deque.popBack()).toBe('c')
    expect(deque.popFront()).toBe('a')
    expect(deque.popFront()).toBe('b')
    expect(deque.popFront()).toBeUndefined()
    expect(deque.size).toBe(0)
  })
})
