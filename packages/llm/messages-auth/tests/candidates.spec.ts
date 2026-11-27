/** Which kinds a request can authenticate with, in which order, and where each one is sent. */
import { afterEach, describe, expect, it } from 'vitest'
import { MessagesAuthError } from '@game-agent/messages-auth'
import { DEPLOYMENT, disposeMounted, mount, request, summary } from './rig.ts'

const ROUTE = 'https://route.example.test/anthropic'

afterEach(disposeMounted)

describe('billing', () => {
  it.each([
    ['api-key', undefined],
    ['api-key', 'other-route'],
    ['auto', 'messages'],
    ['auto', 'other-route'],
    ['auto', undefined],
    [undefined, undefined],
  ] as const)('tries the API key for %j billing on route %j', async (billing, route) => {
    const ctx = await mount()
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    const entries = ctx.messagesAuth.candidates(request({ ...billing === undefined ? {} : { billing }, route }))
    expect(entries.map(entry => entry.kind)).toEqual(['api-key'])
  })

  it('never offers a kind the destination does not accept', async () => {
    const ctx = await mount({ environment: { MODEL_BASE_URL: DEPLOYMENT } })
    expect(summary(ctx.messagesAuth.candidates(request({ destination: { path: '/v1/tools/asr' } }))))
      .toEqual(['api-key https://api.example.test/v1/tools/asr'])
    expect(ctx.messagesAuth.candidates(request({ accepts: [] }))).toEqual([])
  })

  it('names the kind a route bills by the id its plugin connected, for as long as that plugin stays mounted', async () => {
    const ctx = await mount()
    const kinds = () => ['gateway', 'messages', undefined].map(route => ctx.messagesAuth.routeKind(route))
    expect(kinds()).toEqual([undefined, undefined, undefined])
    const route = await ctx.plugin({ name: 'gateway-route', inject: ['messagesAuth'], apply: (scope: typeof ctx) => {
      scope.effect(() => scope.messagesAuth.connect('api-key', 'gateway', () => ({ baseURL: ROUTE })))
    } })
    expect(kinds()).toEqual(['api-key', undefined, undefined])
    await route.dispose()
    expect(kinds()).toEqual([undefined, undefined, undefined])
  })
})

describe('connections', () => {
  it('sends the API key to the origin of the deployment its model route plugin connected', async () => {
    const ctx = await mount({ environment: { MODEL_BASE_URL: DEPLOYMENT } })
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    expect(summary(ctx.messagesAuth.candidates(request()))).toEqual(['api-key https://route.example.test/v1/models'])
  })

  it('reads the connected settings for each request', async () => {
    const ctx = await mount()
    let baseURL = ROUTE
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL })))
    baseURL = 'https://next.example.test/anthropic'
    expect(summary(ctx.messagesAuth.candidates(request()))).toEqual(['api-key https://next.example.test/v1/models'])
  })

  it('removes a connection with the plugin that made it', async () => {
    const ctx = await mount({ environment: { MODEL_BASE_URL: DEPLOYMENT } })
    const plugin = await ctx.plugin({ name: 'route', inject: ['messagesAuth'], apply: (scope: typeof ctx) => {
      scope.effect(() => scope.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    } })
    expect(summary(ctx.messagesAuth.candidates(request()))).toEqual(['api-key https://route.example.test/v1/models'])
    await plugin.dispose()
    expect(summary(ctx.messagesAuth.candidates(request()))).toEqual(['api-key https://api.example.test/v1/models'])
  })

  it('refuses a second connection of one kind', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    expect(() => ctx.messagesAuth.connect('api-key', 'another-route', () => ({ baseURL: ROUTE })))
      .toThrow(expect.objectContaining({ constructor: MessagesAuthError, code: 'DUPLICATE_CONNECTION' }))
  })

  it('prefers the connection a request carries over the connected one', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', () => ({ baseURL: ROUTE })))
    const own = { 'api-key': { baseURL: 'https://own.example.test/api/v1/tools' } }
    expect(summary(ctx.messagesAuth.candidates(request({ connections: own })))).toEqual(['api-key https://own.example.test/v1/models'])
  })

  it.each([
    ['throw', () => { throw new Error('settings do not resolve') }],
    ['name no URL', () => ({ baseURL: 'not a url' })],
  ] as const)('marks the API key unresolved when its connected settings %s', async (_label, connection) => {
    const ctx = await mount()
    ctx.effect(() => ctx.messagesAuth.connect('api-key', 'messages', connection))
    expect(ctx.messagesAuth.candidates(request())).toMatchObject([{ kind: 'api-key', unresolved: 'connection' }])
  })
})
