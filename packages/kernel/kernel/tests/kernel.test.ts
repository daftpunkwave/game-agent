/**
 * Responsibilities: Verify that plugin effects are reversed on disposal and that event listeners stop receiving events once disposed.
 * Contracts: Uses a fresh root context per test; no timers, filesystem, or network.
 * Constraints: Exercises only the public context API.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '../src/index.ts'

describe('kernel', () => {
  it('runs plugin effects and reverses them when the plugin is disposed', async () => {
    const root = new Context()
    const events: string[] = []
    const fiber = root.plugin((ctx: Context) => {
      events.push('apply')
      ctx.effect(() => () => {
        events.push('dispose')
      })
    })
    await fiber
    expect(events).toEqual(['apply'])
    await fiber.dispose()
    expect(events).toEqual(['apply', 'dispose'])
  })

  it('stops delivering events to a listener after it is disposed', async () => {
    const root = new Context()
    const received: number[] = []
    const dispose = root.on('custom-event' as never, ((value: number) => {
      received.push(value)
    }) as never)
    root.emit('custom-event' as never, 1 as never)
    dispose()
    root.emit('custom-event' as never, 2 as never)
    expect(received).toEqual([1])
  })
})
