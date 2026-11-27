import { describe, expect, it } from 'vitest'
import { GameAgentError } from '../src/index.ts'

class SampleError extends GameAgentError {}

describe('GameAgentError', () => {
  it('carries a code, a cause, and the constructing class name', () => {
    const cause = new Error('underlying failure')
    const error = new SampleError('operation failed', 'SAMPLE_FAILED', { cause })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(GameAgentError)
    expect(error).toMatchObject({ name: 'SampleError', code: 'SAMPLE_FAILED', message: 'operation failed', cause })
  })

  it('names a direct instance GameAgentError', () => {
    expect(new GameAgentError('failed', 'FAILED').name).toBe('GameAgentError')
  })
})
