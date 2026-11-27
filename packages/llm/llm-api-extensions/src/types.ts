/** Provider-specific JSON and contribution types for provider request extensions. */

/** Lossless JSON value accepted by the provider request body. */
export type LlmApiJson =
  | null
  | boolean
  | number
  | string
  | LlmApiJson[]
  | { [key: string]: LlmApiJson }

/**
 * Merge-extensible table of top-level provider request extension fields.
 * Contributor packages declaration-merge the field they own.
 */
export interface LlmApiExtensionMap {}

/** Exact serialized request facts visible to extension providers. */
export interface LlmApiExtensionRequest {
  /** Base provider request body before extension fields are merged. */
  readonly body: Readonly<Record<string, LlmApiJson>>
  /** Session identity carried by the model request, when present. */
  readonly sessionId?: string
  /** Auxiliary request classification, when present. */
  readonly purpose?: string
  /** Cancellation for request preparation; providers must stop promptly after abort. */
  readonly signal: AbortSignal
}

/** One prepared field value and its optional post-2xx commit. */
export interface PreparedLlmApiExtension<T extends LlmApiJson> {
  /** Detached value merged under the provider's registered field. */
  readonly value: T
  /** Commit state that depends on confirmed provider acceptance. */
  accept?(): void | Promise<void>
}

/** Provider registered under one key of {@link LlmApiExtensionMap}. */
export interface LlmApiExtensionProvider<T extends LlmApiJson> {
  /**
   * Prepare one field for an exact serialized request.
   * @param request - immutable base request facts.
   * @returns the prepared field, or `undefined` when this request has no value for it.
   */
  prepare(
    request: LlmApiExtensionRequest,
  ): PreparedLlmApiExtension<T> | undefined | Promise<PreparedLlmApiExtension<T> | undefined>
}

/** All fields prepared for one request plus their joint acceptance transaction. */
export interface PreparedLlmApiExtensions {
  /** Detached top-level fields to merge into the base request. */
  readonly fields: Readonly<Partial<LlmApiExtensionMap>>
  /**
   * Commit every captured provider after HTTP 2xx. Repeated calls join the same settlement.
   * @returns fulfillment after every commit succeeds.
   */
  accept(): Promise<void>
}
