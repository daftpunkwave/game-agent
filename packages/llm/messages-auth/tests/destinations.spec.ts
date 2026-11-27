/** Where a credential may be sent: absolute destinations, and the deployment of the API key no model route connected. */
import { afterEach, describe, expect, it } from 'vitest'
import { disposeMounted, mount, request, summary } from './rig.ts'

afterEach(disposeMounted)

describe('absolute destinations', () => {
  const ROUTE = 'https://route.example.test/anthropic'

  it('offers a kind for a URL under the origin of its deployment', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    const url = 'https://route.example.test/anthropic/v1/models'
    expect(summary(ctx.messagesAuth.candidates(request({ destination: { url } })))).toEqual([`api-key ${url}`])
  })

  it.each([
    'https://other.example.test/anthropic/v1/models',
    'http://route.example.test/anthropic/v1/models',
    'https://user:secret@route.example.test/anthropic/v1/models',
  ])('offers no kind for %s, which is outside the deployment or embeds credentials', async (url) => {
    const ctx = await mount()
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    expect(ctx.messagesAuth.candidates(request({ destination: { url } }))).toEqual([])
  })

  it('marks a kind unresolved for a destination that is no URL', async () => {
    const ctx = await mount({ environment: { MODEL_BASE_URL: 'https://api.example.test' } })
    expect(ctx.messagesAuth.candidates(request({ destination: { url: 'not a url' } })))
      .toMatchObject([{ kind: 'api-key', unresolved: 'connection' }])
  })
})

describe('the API key deployment without a connected model route', () => {
  it('is the origin MODEL_BASE_URL names', async () => {
    const ctx = await mount({ environment: { MODEL_BASE_URL: 'https://gateway.example.test/anthropic' } })
    expect(summary(ctx.messagesAuth.candidates(request()))).toEqual(['api-key https://gateway.example.test/v1/models'])
  })

  it.each([[{}], [{ MODEL_BASE_URL: '' }]])('is unresolved for environment %j, naming the deployment', async (environment) => {
    const ctx = await mount({ environment })
    const [entry] = ctx.messagesAuth.candidates(request())
    expect(entry).toMatchObject({ kind: 'api-key', unresolved: 'deployment' })
    expect(String((entry as { error: unknown }).error)).toContain('MODEL_BASE_URL is not set')
  })

  it.each(['not a url', 'ftp://gateway.example.test', 'https://user:secret@gateway.example.test'])(
    'is unresolved for MODEL_BASE_URL=%s, naming the deployment', async (value) => {
      const ctx = await mount({ environment: { MODEL_BASE_URL: value } })
      const [entry] = ctx.messagesAuth.candidates(request())
      expect(entry).toMatchObject({ kind: 'api-key', unresolved: 'deployment' })
      expect(entry).toHaveProperty('error', expect.any(Error))
    })
})
