/** Reading and releasing the API key, and stopping at a kind that does not resolve. */
import { afterEach, describe, expect, it } from 'vitest'
import { credentialRef } from '@game-agent/credentials'
import { MessagesAuthError } from '@game-agent/messages-auth'
import { candidate, DEPLOYMENT, disposeMounted, mount, request } from './rig.ts'

afterEach(disposeMounted)

const LISTING = 'https://api.example.test/v1/models'
const environment = { MODEL_BASE_URL: DEPLOYMENT }
const key = request({ billing: 'api-key' })

describe('the API key', () => {
  it('is read under MODEL_API_KEY and sent as a bearer token by default', async () => {
    const ctx = await mount({ environment, stored: { MODEL_API_KEY: ' sk-stored ' } })
    const [entry] = ctx.messagesAuth.candidates(key)
    expect(await candidate(entry).configured()).toBe(true)
    expect(await ctx.messagesAuth.authorize(key)).toEqual({
      kind: 'api-key', endpoint: LISTING, reference: 'MODEL_API_KEY', headers: { authorization: 'Bearer sk-stored' },
    })
  })

  it.each([
    [['x-api-key'], { 'x-api-key': 'sk-stored' }],
    [['x-api-key', 'authorization'], { 'x-api-key': 'sk-stored', 'authorization': 'Bearer sk-stored' }],
  ] as const)('is sent in the headers the request names: %j', async (apiKeyHeaders, headers) => {
    const ctx = await mount({ environment, stored: { MODEL_API_KEY: 'sk-stored' } })
    expect((await ctx.messagesAuth.authorize({ ...key, apiKeyHeaders }))?.headers).toEqual(headers)
  })

  it('is read under the reference of its connection', async () => {
    const ctx = await mount({ stored: { MODEL_API_KEY: 'sk-default', ROUTE_KEY: 'sk-route' } })
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: 'https://route.example.test', reference: credentialRef('ROUTE_KEY') })))
    expect(await ctx.messagesAuth.authorize(key)).toMatchObject({ reference: 'ROUTE_KEY', headers: { authorization: 'Bearer sk-route' } })
  })

  it('is read from the launch environment only without a credentials service', async () => {
    const ambient = await mount({ environment: { ...environment, MODEL_API_KEY: 'sk-ambient' } })
    expect((await ambient.messagesAuth.authorize(key))?.headers).toEqual({ authorization: 'Bearer sk-ambient' })
    const authoritative = await mount({ environment: { ...environment, MODEL_API_KEY: 'sk-ambient' }, stored: {} })
    expect(await candidate(authoritative.messagesAuth.candidates(key)[0]).configured()).toBe(false)
    expect(await authoritative.messagesAuth.authorize(key)).toBeUndefined()
  })

  it.each([
    [
      '   ', undefined,
      'web-test: the API key resolved from MODEL_API_KEY is blank; set MODEL_API_KEY to the raw key'
      + ' (the web Models page writes it) or export it in the launching environment',
    ],
    [
      'sk-你好', 'llm-messages',
      'llm-messages: the API key resolved from MODEL_API_KEY contains characters no HTTP header can carry;'
      + ' set MODEL_API_KEY to the raw key alone (the web Models page writes it)',
    ],
  ])('refuses the unusable key %j, naming its owner and reference and never the key', async (value, owner, message) => {
    const ctx = await mount({ stored: { MODEL_API_KEY: value } })
    const connections = { 'api-key': { baseURL: DEPLOYMENT, ...owner === undefined ? {} : { owner } } }
    const failure = await ctx.messagesAuth.authorize({ ...key, connections }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(MessagesAuthError)
    expect(failure).toMatchObject({ code: 'INVALID_CREDENTIAL', message })
  })

  it('starts no read for a cancelled lookup', async () => {
    const ctx = await mount({ environment, stored: { MODEL_API_KEY: 'sk-stored' } })
    const reason = new Error('cancelled')
    await expect(ctx.messagesAuth.authorize(key, AbortSignal.abort(reason))).rejects.toBe(reason)
  })
})

describe('authorize', () => {
  it('releases nothing when no key is configured', async () => {
    const ctx = await mount({ environment, stored: {} })
    expect(await ctx.messagesAuth.authorize(request())).toBeUndefined()
  })

  it('stops at an unresolved connection', async () => {
    const ctx = await mount({ stored: { MODEL_API_KEY: 'sk-stored' } })
    const failure = new Error('settings do not resolve')
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => { throw failure }))
    const stopped = await ctx.messagesAuth.authorize(request()).catch((error: unknown) => error)
    expect(stopped).toMatchObject({ code: 'UNRESOLVED_CONNECTION', cause: failure })
    expect((stopped as Error).message).toContain('the api-key connection does not resolve: Error: settings do not resolve')
  })

  it('stops at an unresolved deployment without a connected route', async () => {
    const ctx = await mount({ stored: { MODEL_API_KEY: 'sk-stored' } })
    const stopped = await ctx.messagesAuth.authorize(request()).catch((error: unknown) => error)
    expect(stopped).toBeInstanceOf(MessagesAuthError)
    expect((stopped as Error).message).toContain('the api-key deployment does not resolve')
  })

  it('propagates a credential store failure', async () => {
    const ctx = await mount({ environment })
    const failure = new Error('store unreadable')
    ctx.provide('credentials', { resolve: () => Promise.reject(failure) } as never)
    await expect(ctx.messagesAuth.authorize(key)).rejects.toBe(failure)
  })
})
