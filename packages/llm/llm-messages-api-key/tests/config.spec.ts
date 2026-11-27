/** The API-key route resolves its key reference with the endpoint settings and takes its models from settings only. */
import { expect, it } from 'vitest'
import { Config, plainOptions, resolveAdapterOptions } from '../src/config.ts'

const ENDPOINT = 'https://api.example.test/anthropic'

it('resolves the key reference together with the endpoint settings', () => {
  expect(resolveAdapterOptions({ baseURL: ENDPOINT })).toMatchObject({ baseURL: ENDPOINT, apiKeyEnv: 'MODEL_API_KEY', models: [] })
  expect(resolveAdapterOptions(plainOptions(Config({ baseURL: ENDPOINT, apiKeyEnv: 'ROUTE_KEY' })))).toMatchObject({
    baseURL: ENDPOINT, apiKeyEnv: 'ROUTE_KEY',
  })
})

it.each([
  [{ baseURL: ENDPOINT }],
  [{ baseURL: ENDPOINT, models: [{ id: 'custom' }] }],
  [{ baseURL: ENDPOINT, models: [] }],
])('follows no model listing for %j', (options) => {
  expect(resolveAdapterOptions(options)).not.toHaveProperty('listing')
})

it('requires an endpoint from settings or the launch environment', () => {
  expect(() => resolveAdapterOptions({ models: [{ id: 'custom' }] })).toThrow(/set baseURL or MODEL_BASE_URL/)
})
