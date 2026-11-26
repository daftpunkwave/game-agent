/**
 * Responsibilities: Adapt any provider that speaks the OpenAI-compatible Chat Completions API to the `ModelAdapter` port.
 * Contracts: Sends one system and one user message with function tools; maps text, tool calls, and token usage (including cached input) back to port types.
 * Constraints: The API key is supplied by the composition root and never appears in errors; `fetch` is injectable for tests.
 */
import { isJsonObject, type JsonValue } from '@game-agent/contracts'
import type { ModelAdapter, ModelRequest, ModelResponse, ModelToolCall, ModelUsage } from '@game-agent/decision'
import { GameAgentError } from '@game-agent/errors'

/** Connection settings for one provider endpoint. */
export interface OpenAiCompatibleConfig {
  /** Base URL up to and excluding `/chat/completions`, e.g. `https://api.deepseek.com`. */
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
  readonly temperature?: number
  readonly fetch?: typeof fetch
}

interface WireToolCall {
  function?: { name?: unknown; arguments?: unknown }
}

const ERROR_BODY_LIMIT = 300

function numberOr(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseUsage(raw: JsonValue | undefined): ModelUsage | undefined {
  if (!isJsonObject(raw)) return undefined
  const details = raw['prompt_tokens_details']
  const cached = isJsonObject(details) ? numberOr(details['cached_tokens'], 0) : numberOr(raw['prompt_cache_hit_tokens'], 0)
  return { inputTokens: numberOr(raw['prompt_tokens'], 0), outputTokens: numberOr(raw['completion_tokens'], 0), cachedInputTokens: cached }
}

/** Model adapter for OpenAI-compatible endpoints. */
export class OpenAiCompatibleModelAdapter implements ModelAdapter {
  readonly name: string
  private readonly config: OpenAiCompatibleConfig

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config
    this.name = `openai-compatible:${config.model}`
  }

  async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const body = {
      model: this.config.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      max_tokens: request.maxOutputTokens,
      ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
      ...(request.tools.length === 0
        ? {}
        : {
            tool_choice: 'auto',
            tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
          }),
    }
    const response = await (this.config.fetch ?? fetch)(`${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, ERROR_BODY_LIMIT)
      throw new GameAgentError(`Model request failed with status ${response.status}: ${detail}`, 'MODEL_HTTP_ERROR')
    }
    const payload = (await response.json()) as JsonValue
    const choices = isJsonObject(payload) ? payload['choices'] : undefined
    const first = Array.isArray(choices) ? choices[0] : undefined
    const message = isJsonObject(first) ? first['message'] : undefined
    if (!isJsonObject(message)) throw new GameAgentError('Model response has no message', 'MODEL_MALFORMED_RESPONSE')

    const toolCalls: ModelToolCall[] = []
    const malformedCalls: { name: string; raw: string }[] = []
    const wireCalls = Array.isArray(message['tool_calls']) ? (message['tool_calls'] as WireToolCall[]) : []
    for (const call of wireCalls) {
      const name = typeof call.function?.name === 'string' ? call.function.name : ''
      const raw = typeof call.function?.arguments === 'string' ? call.function.arguments : '{}'
      try {
        const parsed = JSON.parse(raw === '' ? '{}' : raw) as JsonValue
        if (isJsonObject(parsed)) toolCalls.push({ name, arguments: parsed })
        else malformedCalls.push({ name, raw })
      } catch {
        malformedCalls.push({ name, raw })
      }
    }
    const usage = parseUsage(isJsonObject(payload) ? payload['usage'] : undefined)
    return {
      text: typeof message['content'] === 'string' ? message['content'] : '',
      toolCalls,
      malformedCalls,
      ...(usage === undefined ? {} : { usage }),
    }
  }
}
