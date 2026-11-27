/**
 * Types of model provider request authentication. Host-only: an authorization carries a secret, so none of these
 * values crosses a Remote boundary or enters a log.
 * @module @game-agent/messages-auth/types
 */
import type { CredentialRef } from '@game-agent/credentials'

/** A way to authenticate a model provider request. The API key is the only kind. */
export type MessagesAuthKind = 'api-key'

/** Which credential pays for an operation: one kind only, or `auto`, which follows the conversation's model route. */
export type MessagesAuthBilling = 'auto' | MessagesAuthKind

/** Request header an API key is sent in: `authorization` as `Bearer <key>`, `x-api-key` as the bare key. */
export type MessagesApiKeyHeader = 'authorization' | 'x-api-key'

/** The deployment the credential of one kind belongs to, and where the API key is read. */
export interface MessagesAuthConnection {
  /** Base URL of the deployment; the credential is sent only to destinations under its origin. */
  readonly baseURL: string
  /** The credential reference the key is read under; `MODEL_API_KEY` when omitted. */
  readonly reference?: CredentialRef
  /**
   * The settings namespace or package name prefixed to the diagnostic of an unusable key; the request's `consumer`
   * when omitted.
   */
  readonly owner?: string
}

/**
 * Where one request goes: a path appended to the origin of the chosen kind's deployment, or one absolute URL, which a
 * kind serves only when the URL is under the origin of that kind's deployment and embeds no credentials.
 */
export type MessagesAuthDestination = { readonly path: string } | { readonly url: string }

/** One model provider request that needs authentication. */
export interface MessagesAuthRequest {
  /** Name of the requesting plugin, prefixed to the diagnostic of an unusable key whose connection names no owner. */
  readonly consumer: string
  /** Kinds the destination API accepts; a kind outside this list is never a candidate. */
  readonly accepts: readonly MessagesAuthKind[]
  /** Which credential pays; `auto` when omitted. */
  readonly billing?: MessagesAuthBilling
  /** Provider route of the model request this operation serves. */
  readonly route?: string | undefined
  /** Where the request goes. */
  readonly destination: MessagesAuthDestination
  /**
   * The caller's own connection of a kind, used in place of the connected or default one: the configuration
   * generation a model route captured for one request, or a consumer's own endpoint and key.
   */
  readonly connections?: Readonly<Partial<Record<MessagesAuthKind, MessagesAuthConnection>>>
  /** Headers an API key is sent in; `authorization` when omitted. */
  readonly apiKeyHeaders?: readonly MessagesApiKeyHeader[]
}

/** The credential of one kind released for one request, ready to send. */
export interface MessagesAuthorization {
  /** Kind of the credential. */
  readonly kind: MessagesAuthKind
  /** Absolute URL the request is sent to. */
  readonly endpoint: string
  /** Request headers carrying the credential. */
  readonly headers: Readonly<Record<string, string>>
  /** The reference the key was read under, for diagnostics that tell the user where to configure it. */
  readonly reference?: CredentialRef
  /**
   * Invalidate this exact credential after the destination rejected it with HTTP 401, so no later request resends
   * it. Absent for kinds without invalidation, which the API key is.
   * @returns settlement after the invalidation attempt.
   */
  reject?(): Promise<void>
  /**
   * Aborts when the owner withdraws the credential while requests may carry it. Absent for kinds that are never
   * withdrawn, which the API key is.
   */
  readonly revoked?: AbortSignal
}

/** One kind a request can authenticate with, in the order the billing chose. Nothing is read until asked. */
export interface MessagesAuthCandidate {
  /** Kind of the credential. */
  readonly kind: MessagesAuthKind
  /** Absolute URL a request authenticated with this kind is sent to. */
  readonly endpoint: string
  /** The reference the key is read under. */
  readonly reference?: CredentialRef
  /**
   * Whether {@link resolve} would release a credential, checked without validating it or contacting the
   * destination. Store failures reject.
   * @returns whether a credential of this kind is configured for the endpoint.
   */
  configured(): Promise<boolean>
  /**
   * Release the credential, or `undefined` when none is configured. Store failures and an unusable key reject.
   * @param signal - cancellation for the lookup.
   * @returns the authorization, or `undefined`.
   */
  resolve(signal?: AbortSignal): Promise<MessagesAuthorization | undefined>
}

/** A kind the billing chose whose connection does not resolve; an operation that reaches it stops there. */
export interface MessagesAuthUnresolved {
  /** Kind of the credential. */
  readonly kind: MessagesAuthKind
  /**
   * What did not resolve: the `connection` a model route plugin connected or the caller supplied, or the `deployment`
   * `MODEL_BASE_URL` names without a connected route.
   */
  readonly unresolved: 'connection' | 'deployment'
  /** The failure. */
  readonly error: unknown
}
