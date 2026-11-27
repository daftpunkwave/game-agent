/**
 * LLM API extension registry: plugins own independent top-level request
 * fields while the official adapter performs one preparation and acceptance transaction.
 * @module @game-agent/llm-api-extensions
 */

import { Context, Service } from '@game-agent/kernel'
import type {
  LlmApiExtensionMap,
  LlmApiExtensionProvider,
  LlmApiExtensionRequest,
  LlmApiJson,
  PreparedLlmApiExtensions,
} from './types.ts'

export type * from './types.ts'

declare module '@game-agent/kernel' {
  interface Context {
    llmApiExtensions: LlmApiExtensionRegistry
  }
}

interface ErasedProvider {
  prepare(request: LlmApiExtensionRequest):
    | { readonly value: LlmApiJson; accept?(): void | Promise<void> }
    | undefined
    | Promise<{ readonly value: LlmApiJson; accept?(): void | Promise<void> } | undefined>
}

/** Recursively freeze a fresh structured clone. */
function freezeJson<T extends LlmApiJson>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

/** Settle every acceptance callback before reporting failures. */
async function acceptAll(callbacks: readonly (() => void | Promise<void>)[]): Promise<void> {
  const outcomes = await Promise.allSettled(callbacks.map(callback => Promise.resolve().then(callback)))
  const failures: unknown[] = outcomes
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map(outcome => outcome.reason as unknown)
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'LLM API extension acceptance failed')
}

/** Stop awaiting provider work when the containing model request is cancelled. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await Promise.race([work, aborted.promise])
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Registry of independently owned top-level fields for provider requests. */
export class LlmApiExtensionRegistry extends Service {
  private readonly providers = new Map<string, ErasedProvider>()
  /** Fields whose preparation failure was already logged; later failures stay silent. */
  private readonly warnedFields = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'llmApiExtensions')
  }

  /**
   * Register the sole provider of one top-level request field. Registration is effect-scoped.
   * @param field - declaration-merged field owned by the provider.
   * @param provider - request-time field preparation and optional acceptance behavior.
   * @returns disposer that releases the field.
   */
  register<K extends keyof LlmApiExtensionMap>(
    field: K,
    provider: LlmApiExtensionProvider<LlmApiExtensionMap[K]>,
  ): () => Promise<void> {
    const fieldName = field as string
    if (fieldName.length === 0 || fieldName.trim() !== fieldName) {
      throw new Error('llm-api-extensions: field must be a non-blank trimmed string')
    }
    const providers = this.providers
    const erased = provider as ErasedProvider
    const dispose = this.ctx.effect(() => {
      if (providers.has(fieldName)) {
        throw new Error(`llm-api-extensions: field ${JSON.stringify(fieldName)} is already registered`)
      }
      providers.set(fieldName, erased)
      return () => {
        providers.delete(fieldName)
      }
    }, `llmApiExtensions.register(${JSON.stringify(fieldName)})`)
    return dispose
  }

  /**
   * Prepare every currently registered field from one immutable base request.
   * A provider whose preparation throws, or whose value cannot be cloned, is omitted
   * from this request; the first such failure per field is logged. Only cancellation rejects. Field values are cloned
   * and frozen; providers retain no mutable alias to the outgoing request.
   * @param request - exact serialized request facts before extension fields.
   * @returns detached fields and their idempotent joint acceptance transaction.
   */
  async prepare(request: LlmApiExtensionRequest): Promise<PreparedLlmApiExtensions> {
    request.signal.throwIfAborted()
    const entries = [...this.providers.entries()]
    const prepared = await abortable(Promise.all(entries.map(async ([field, provider]) => {
      try {
        const result = await provider.prepare(request)
        return result === undefined ? undefined : { field, value: freezeJson(structuredClone(result.value)), result }
      } catch (error) {
        if (!request.signal.aborted && !this.warnedFields.has(field)) {
          this.warnedFields.add(field)
          this.ctx.logger.warn(`llm-api-extensions: omitting field ${JSON.stringify(field)} from this request because its preparation failed: %o`, error)
        }
        return undefined
      }
    })), request.signal)
    const fields: Record<string, LlmApiJson> = Object.create(null) as Record<string, LlmApiJson>
    const callbacks: Array<() => void | Promise<void>> = []
    for (const item of prepared) {
      if (item === undefined) continue
      const { field, value, result } = item
      fields[field] = value
      const accept = result.accept
      if (accept !== undefined) callbacks.push(accept.bind(result))
    }
    Object.freeze(fields)
    let acceptance: Promise<void> | undefined
    return {
      fields,
      accept: () => acceptance ??= acceptAll(callbacks),
    }
  }
}

export default LlmApiExtensionRegistry
