/** Recognizing the built-in catalog, which is how an uncustomized `models` setting resolves: no models ship with the adapter. */
import { expect, it } from 'vitest'
import { Config, isBuiltInCatalog, plainOptions, resolveAdapterOptions } from '../src/config.ts'
import { DEFAULT_MODELS } from '../src/models.ts'
import { TEST_BASE_URL, TEST_MODELS } from './helpers.ts'

it('ships no built-in models', () => {
  expect(DEFAULT_MODELS).toEqual([])
})

it('recognizes the built-in catalog however it was supplied', () => {
  expect(isBuiltInCatalog(resolveAdapterOptions({ baseURL: TEST_BASE_URL }).models)).toBe(true)
  expect(isBuiltInCatalog(resolveAdapterOptions({ baseURL: TEST_BASE_URL, models: [] }).models)).toBe(true)
  expect(isBuiltInCatalog(resolveAdapterOptions(plainOptions(Config({ baseURL: TEST_BASE_URL }))).models)).toBe(true)
})

it('treats any configured catalog as customized', () => {
  const [flash, pro] = resolveAdapterOptions({ baseURL: TEST_BASE_URL, models: TEST_MODELS }).models
  expect(isBuiltInCatalog([flash!])).toBe(false)
  expect(isBuiltInCatalog([flash!, pro!])).toBe(false)
})
