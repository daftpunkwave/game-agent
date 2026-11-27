import { describe, expect, it } from 'vitest'
import { GameAgentError } from '@game-agent/error'
import { RemoteError, remoteErrorOf } from '@game-agent/typert-protocol'

describe('RemoteError', () => {
  it('is a GameAgentError that keeps its Remote code, details, and cause', () => {
    const cause = new Error('backend closed')
    const error = new RemoteError('gateway/bad-request', 'name is required', { issues: [{ path: ['name'] }] }, { cause })

    expect(error).toBeInstanceOf(GameAgentError)
    expect(error).toMatchObject({
      name: 'RemoteError',
      code: 'gateway/bad-request',
      message: 'name is required',
      details: { issues: [{ path: ['name'] }] },
      cause,
    })
    expect(remoteErrorOf(error)).toBe(error)
  })
})
