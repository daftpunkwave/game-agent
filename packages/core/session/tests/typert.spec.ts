import { describe, expect, it } from 'vitest'
import { Context } from '@game-agent/kernel'
import SessionStore, { type SessionId } from '@game-agent/session'
import TypertRegistry from '@game-agent/typert-registry'
import { brandString } from '@game-agent/brand'

describe('Session Typert provider', () => {
  it('contributes live Session lookup in either service load order', async () => {
    const ctx = new Context()
    const sessionFiber = ctx.plugin(SessionStore)
    await sessionFiber
    await ctx.plugin(TypertRegistry)
    const session = ctx.sessions.create(brandString<SessionId>('remote-session'))

    const lookup = ctx.typert.lookups.get('session')
    expect(lookup).toMatchObject({
      parameter: 'session',
      wire: 'sessionId',
      resource: 'session',
      hostTypeSymbol: '@game-agent/session#Session',
      wireTypeSymbol: '@game-agent/session/types#SessionId',
    })
    expect(lookup?.resolve(session.id)).toBe(session)

    await sessionFiber.dispose()
    expect(ctx.typert.lookups.get('session')).toBeUndefined()
  })
})
