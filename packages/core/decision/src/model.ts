/**
 * Responsibilities: Define the port through which the runtime calls a language model, plus a scripted implementation for tests and simulations.
 * Contracts: One request yields one response; tool calls are proposals, never executed by the adapter. Malformed calls are reported, not dropped silently.
 * Constraints: Vendor SDK types must not appear here; concrete providers live in separate adapter packages.
 */
import type { JsonObject, JsonObjectSchema } from '@game-agent/contracts'

/** Tool offered to the model for one decision. */
export interface ModelToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: JsonObjectSchema
}

/** One bounded model request: a stable system prefix and one user message. */
export interface ModelRequest {
  readonly system: string
  readonly user: string
  readonly tools: readonly ModelToolSpec[]
  readonly maxOutputTokens: number
}

/** A tool call proposed by the model. */
export interface ModelToolCall {
  readonly name: string
  readonly arguments: JsonObject
}

/** Token accounting reported by the provider. */
export interface ModelUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedInputTokens: number
}

/** Model answer. */
export interface ModelResponse {
  readonly text: string
  readonly toolCalls: readonly ModelToolCall[]
  /** Tool calls whose arguments could not be parsed. */
  readonly malformedCalls: readonly { readonly name: string; readonly raw: string }[]
  readonly usage?: ModelUsage
}

/** Port implemented by every model provider adapter. */
export interface ModelAdapter {
  readonly name: string
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>
}

/** Model double that answers from a script; used by tests and accelerated simulations. */
export class ScriptedModelAdapter implements ModelAdapter {
  readonly name = 'scripted'
  readonly requests: ModelRequest[] = []
  private readonly script: (request: ModelRequest) => ModelResponse

  /** @param script - computes the response for each request. */
  constructor(script: (request: ModelRequest) => ModelResponse) {
    this.script = script
  }

  async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    signal.throwIfAborted()
    this.requests.push(request)
    return this.script(request)
  }
}
