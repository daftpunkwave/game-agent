/**
 * Responsibilities: Verify request shape, response mapping, malformed tool arguments, and HTTP error handling.
 * Contracts: Uses an injected fetch double; no network access.
 * Constraints: Asserts that the API key never appears in thrown errors.
 */
import { describe, expect, it } from 'vitest'
import { OpenAiCompatibleModelAdapter } from '../src/index.ts'

function adapterWith(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; body: unknown }[] = []
  const adapter = new OpenAiCompatibleModelAdapter({
    baseUrl: 'https://models.example/',
    model: 'test-model',
    apiKey: 'secret-key',
    fetch: async (input, init) => {
      const url = String(input)
      calls.push({ url, body: JSON.parse(String(init?.body)) })
      return handler(url, init ?? {})
    },
  })
  return { adapter, calls }
}

const request = {
  system: 'rules',
  user: 'state',
  tools: [{ name: 'scout', description: 'Scout', parameters: { type: 'object' as const } }],
  maxOutputTokens: 256,
}

describe('OpenAiCompatibleModelAdapter', () => {
  it('maps text, tool calls, malformed arguments, and cached token usage', async () => {
    const { adapter, calls } = adapterWith(() =>
      Response.json({
        choices: [
          {
            message: {
              content: 'Scouting first.',
              tool_calls: [
                { function: { name: 'scout', arguments: '{"tile":"c3"}' } },
                { function: { name: 'scout', arguments: '{oops' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } },
      }),
    )
    const response = await adapter.complete(request, new AbortController().signal)
    expect(calls[0]?.url).toBe('https://models.example/chat/completions')
    expect(calls[0]?.body).toMatchObject({ model: 'test-model', max_tokens: 256, tool_choice: 'auto', tools: [{ type: 'function', function: { name: 'scout' } }] })
    expect(response).toEqual({
      text: 'Scouting first.',
      toolCalls: [{ name: 'scout', arguments: { tile: 'c3' } }],
      malformedCalls: [{ name: 'scout', raw: '{oops' }],
      usage: { inputTokens: 1200, outputTokens: 30, cachedInputTokens: 1000 },
    })
  })

  it('raises a coded error on HTTP failure without leaking the key', async () => {
    const { adapter } = adapterWith(() => new Response('quota exceeded', { status: 429 }))
    const error = await adapter.complete(request, new AbortController().signal).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'MODEL_HTTP_ERROR', message: 'Model request failed with status 429: quota exceeded' })
    expect(String((error as Error).message)).not.toContain('secret-key')
  })
})
