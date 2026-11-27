/** Model discovery requires the API-key route's own credential. */
import { Context } from '@game-agent/kernel'
import LlmRuntime from '@game-agent/llm'
import { expect, it, vi } from 'vitest'
import * as ApiKey from '../src/index.ts'
import MessagesAuth from '@game-agent/messages-auth'

/** The endpoint every mount names; deployments configure their own. */
const ENDPOINT = { baseURL: 'https://api.example.test/anthropic' }

it.each([undefined, ''])('hides models without an API key: %j', async (key) => {
  vi.stubEnv('MODEL_API_KEY', key)
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    await ctx.plugin(ApiKey, { ...ENDPOINT, models: [{ id: 'configured-model' }] })
    expect(await ctx.llm.listModels('messages')).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('advertises configured models with an API key', async () => {
  vi.stubEnv('MODEL_API_KEY', 'fixture-api-key')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    await ctx.plugin(ApiKey, { ...ENDPOINT, models: [{ id: 'configured-model' }] })
    expect(await ctx.llm.listModels('messages')).toEqual([
      expect.objectContaining({ provider: 'messages', id: 'configured-model' }),
    ])
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('reports malformed credentials during discovery under the settings namespace the provider directory lists', async () => {
  vi.stubEnv('MODEL_API_KEY', 'invalid\nheader')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    await ctx.plugin(ApiKey, { ...ENDPOINT, models: [{ id: 'configured-model' }] })
    const [directory] = ctx.llm.listConfigurableProviders()
    expect(directory?.settingsNs).toBe('llm-messages-api-key')
    const failure = ctx.llm.listModels('messages')
    await expect(failure).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    await expect(failure).rejects.toThrow('llm-messages-api-key: the API key resolved from MODEL_API_KEY contains characters')
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('names the Loader entry id in credential diagnostics, as product profiles mount the route', async () => {
  vi.stubEnv('MODEL_API_KEY', 'invalid\nheader')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    await ctx.plugin({
      name: ApiKey.name, inject: ApiKey.inject, Config: ApiKey.Config,
      apply: (inner: Context, config: ApiKey.Config) => {
        // The Loader attaches the entry before a plugin applies; product profiles use the id `llm-messages`.
        Object.defineProperty(inner.fiber, 'entry', { value: { options: { id: 'llm-messages' } } })
        ApiKey.apply(inner, config)
      },
    }, { ...ENDPOINT, models: [{ id: 'configured-model' }] })
    expect(ctx.llm.listConfigurableProviders().map(entry => entry.settingsNs)).toEqual(['llm-messages'])
    await expect(ctx.llm.listModels('messages')).rejects.toThrow(
      'llm-messages: the API key resolved from MODEL_API_KEY contains characters no HTTP header can carry',
    )
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('connects its route id, key reference and deployment, so other consumers send its key to its origin', async () => {
  vi.stubEnv('MODEL_API_KEY', 'default-key')
  vi.stubEnv('MODEL_BASE_URL', 'https://api.example.test/anthropic')
  vi.stubEnv('ROUTE_KEY', 'fixture-api-key')
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    const search = { consumer: 'web-test', accepts: ['api-key'], billing: 'api-key', destination: { path: '/v1/tools/search' } } as const
    const route = await ctx.plugin(ApiKey, { baseURL: 'https://route.example.test/anthropic', apiKeyEnv: 'ROUTE_KEY' })
    expect(ctx.messagesAuth.routeKind('messages')).toBe('api-key')
    expect(await ctx.messagesAuth.authorize(search)).toEqual({
      kind: 'api-key', endpoint: 'https://route.example.test/v1/tools/search', reference: 'ROUTE_KEY', headers: { authorization: 'Bearer fixture-api-key' },
    })
    vi.stubEnv('ROUTE_KEY', 'invalid\nheader')
    await expect(ctx.messagesAuth.authorize(search)).rejects.toThrow('llm-messages-api-key: the API key resolved from ROUTE_KEY contains characters')
    await route.dispose()
    expect(ctx.messagesAuth.routeKind('messages')).toBeUndefined()
    expect(await ctx.messagesAuth.authorize(search)).toMatchObject({ endpoint: 'https://api.example.test/v1/tools/search', reference: 'MODEL_API_KEY' })
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
  }
})

it('fails a model listing whose credential store cannot be read with the store\'s failure', async () => {
  const failure = new Error('credential store unreadable')
  const ctx = new Context()
  try {
    ctx.provide('credentials', { resolve: () => Promise.reject(failure) } as never)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    await ctx.plugin(ApiKey, { ...ENDPOINT, models: [{ id: 'configured-model' }] })
    await expect(ctx.llm.listModels('messages')).rejects.toBe(failure)
  } finally {
    await ctx.fiber.dispose()
  }
})
