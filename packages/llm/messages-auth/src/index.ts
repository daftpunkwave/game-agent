/**
 * Model provider request authentication (`ctx.messagesAuth`). A consumer names the credential kinds its API accepts
 * and the billing its settings choose; this service binds the API key to the deployment its model route connected
 * and releases the request headers that carry it. Without a connected route the key is `MODEL_API_KEY`, sent to the
 * deployment `MODEL_BASE_URL` names.
 *
 * ```ts
 * const authorization = await ctx.messagesAuth.authorize({
 *   consumer: name, accepts: ['api-key'], billing: 'auto', route, destination: { path: '/v1/models' },
 * }, signal)
 * ```
 *
 * @module @game-agent/messages-auth
 */
import { Context, Service } from '@game-agent/kernel'
import { credentialRef, credentialRefConfigured, normalizeApiKey, resolveCredentialRef } from '@game-agent/credentials'
import type { ApiKeyRejection } from '@game-agent/credentials'
import { GameAgentError } from '@game-agent/error'
import { launchEnvironmentOf } from '@game-agent/launch-environment'
import type {
  MessagesAuthCandidate, MessagesAuthConnection, MessagesAuthKind, MessagesAuthRequest, MessagesAuthUnresolved,
  MessagesAuthorization,
} from './types.ts'

export type * from './types.ts'

declare module '@game-agent/kernel' {
  interface Context { messagesAuth: MessagesAuth }
}

/** Credential reference of the API key sent without a connected model route. */
const MODEL_API_KEY = credentialRef('MODEL_API_KEY')

/** Launch-environment variable naming the deployment that receives the API key without a connected model route. */
const MODEL_BASE_URL_ENV = 'MODEL_BASE_URL'

/** Failure codes of {@link MessagesAuthError}. */
export type MessagesAuthErrorCode =
  /** A second connection of one kind; one model route plugin owns each kind's deployment. */
  | 'DUPLICATE_CONNECTION'
  /** The configured API key is blank or cannot travel in an HTTP header. */
  | 'INVALID_CREDENTIAL'
  /** The connection or deployment of the kind an operation reached does not resolve. */
  | 'UNRESOLVED_CONNECTION'

/** A request authentication failure; `message` never contains a credential. */
export class MessagesAuthError extends GameAgentError {
  declare readonly code: MessagesAuthErrorCode

  /**
   * @param message - what failed and what to change.
   * @param code - the failure class.
   * @param options - the underlying failure.
   */
  constructor(message: string, code: MessagesAuthErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    // Consumers quote this name in their own diagnostics, so it does not follow a bundler's class renaming.
    this.name = 'MessagesAuthError'
  }
}

/**
 * The diagnostic for a configured API key that cannot be sent. The key never enters the text: `reference` names where to
 * fix it. The Models page is named as the writer it usually is, not as the only one, because the same value can arrive
 * from a hand-edited `.env` or a shell export in a composition that mounts no credentials service.
 * @param reason - why the key cannot be sent.
 * @param owner - settings namespace or plugin name prefixed to the text.
 * @param reference - the credential reference the key was read under.
 * @returns the message of the `INVALID_CREDENTIAL` failure.
 */
function unusableKey(reason: ApiKeyRejection, owner: string, reference: string): string {
  const defect: Record<ApiKeyRejection, string> = {
    empty: `is blank; set ${reference} to the raw key (the web Models page writes it) or export it in the launching`
      + ' environment',
    illegalCharacters: `contains characters no HTTP header can carry; set ${reference} to the raw key alone (the web Models`
      + ' page writes it)',
  }
  return `${owner}: the API key resolved from ${reference} ${defect[reason]}`
}

/** Marks a failure of the launch-environment deployment, apart from a failure of a connected route's settings. */
class DeploymentError extends Error {
  /** @param cause - why the variable names no deployment URL. */
  constructor(cause: unknown) { super('unresolved deployment', { cause }) }
}

/** `ctx.messagesAuth`: the API key behind one request-authorization operation. */
export class MessagesAuth extends Service {
  private readonly connections = new Map<MessagesAuthKind, { route: string; connection: () => MessagesAuthConnection }>()

  /** @param ctx - Host context; the credentials service is read when mounted. */
  constructor(ctx: Context) {
    super(ctx, 'messagesAuth')
  }

  /**
   * Connect the deployment a model route plugin's settings name for one kind. Call it from within `ctx.effect()`.
   * @param kind - the kind the plugin's route bills.
   * @param route - provider route the plugin registers; {@link routeKind} answers `kind` for it while connected.
   * @param connection - reads the plugin's current settings; a throw marks the kind unresolved for that operation.
   * @returns the disposer removing the connection.
   * @throws {MessagesAuthError} code `DUPLICATE_CONNECTION` when the kind is already connected.
   */
  connect(kind: MessagesAuthKind, route: string, connection: () => MessagesAuthConnection): () => void {
    if (this.connections.has(kind)) {
      throw new MessagesAuthError(`messages-auth: the ${kind} deployment is already connected`, 'DUPLICATE_CONNECTION')
    }
    this.connections.set(kind, { route, connection })
    return () => { this.connections.delete(kind) }
  }

  /**
   * The kind that bills a conversation on one model route.
   * @param route - provider route of a model request; undefined names none.
   * @returns the kind connected under that route, or undefined for a route no plugin connected.
   */
  routeKind(route: string | undefined): MessagesAuthKind | undefined {
    for (const [kind, connected] of this.connections) {
      if (connected.route === route) return kind
    }
    return undefined
  }

  /**
   * The kinds one request can authenticate with, in the order its billing tries them, each bound to its destination.
   * Nothing is read from a credential store.
   * @param request - the request.
   * @returns candidates and unresolved kinds, first preferred; empty when the destination accepts no kind the
   *   billing allows or no allowed kind serves an absolute destination.
   */
  candidates(request: MessagesAuthRequest): (MessagesAuthCandidate | MessagesAuthUnresolved)[] {
    const billing = request.billing ?? 'auto'
    const kinds: MessagesAuthKind[] = billing === 'auto' ? ['api-key'] : [billing]
    return kinds.filter(kind => request.accepts.includes(kind)).flatMap(kind => this.candidate(kind, request))
  }

  /**
   * Release the credential of the first candidate that has one. A later candidate is not read once an earlier one
   * has a credential, fails to read, or does not resolve.
   * @param request - the request.
   * @param signal - cancellation for the lookups.
   * @returns the authorization, or undefined when no candidate has a credential.
   * @throws {MessagesAuthError} code `UNRESOLVED_CONNECTION` at an unresolved kind, `INVALID_CREDENTIAL` for an
   *   unusable API key; store failures propagate.
   */
  async authorize(request: MessagesAuthRequest, signal?: AbortSignal): Promise<MessagesAuthorization | undefined> {
    for (const candidate of this.candidates(request)) {
      if ('unresolved' in candidate) {
        throw new MessagesAuthError(
          `messages-auth: the ${candidate.kind} ${candidate.unresolved} does not resolve: ${String(candidate.error)}`,
          'UNRESOLVED_CONNECTION', { cause: candidate.error },
        )
      }
      const authorization = await candidate.resolve(signal)
      if (authorization !== undefined) return authorization
    }
    return undefined
  }

  /** Bind one kind to the request's destination; empty when the kind does not serve an absolute destination. */
  private candidate(kind: MessagesAuthKind, request: MessagesAuthRequest): (MessagesAuthCandidate | MessagesAuthUnresolved)[] {
    let connection: MessagesAuthConnection
    try { connection = request.connections?.[kind] ?? this.connections.get(kind)?.connection() ?? this.unconnected() }
    catch (error: unknown) {
      const unresolved = error instanceof DeploymentError ? 'deployment' : 'connection'
      return [{ kind, unresolved, error: error instanceof DeploymentError ? error.cause : error }]
    }
    let endpoint: string
    try {
      const deployment = new URL(connection.baseURL)
      if ('path' in request.destination) endpoint = `${deployment.origin}${request.destination.path}`
      else {
        const destination = new URL(request.destination.url)
        if (destination.origin !== deployment.origin || destination.username !== '' || destination.password !== '') return []
        endpoint = request.destination.url
      }
    } catch (error: unknown) { return [{ kind, unresolved: 'connection', error }] }
    return [this.apiKey(connection, endpoint, request)]
  }

  /** The deployment of the API key while no model route plugin connected one: the origin `MODEL_BASE_URL` names. */
  private unconnected(): MessagesAuthConnection {
    const configured = launchEnvironmentOf(this.ctx).get(MODEL_BASE_URL_ENV)?.value
    if (configured === undefined || configured.length === 0) {
      throw new DeploymentError(new Error(`${MODEL_BASE_URL_ENV} is not set and no model route connected a deployment`))
    }
    try {
      const url = new URL(configured)
      if (!/^https?:$/u.test(url.protocol) || url.username.length > 0 || url.password.length > 0) {
        throw new Error(`${MODEL_BASE_URL_ENV} must be an HTTP(S) URL without credentials`)
      }
    } catch (error: unknown) { throw new DeploymentError(error) }
    return { baseURL: configured }
  }

  /** The API key read under the connection's reference, sent in the headers the request names. */
  private apiKey(connection: MessagesAuthConnection, endpoint: string, request: MessagesAuthRequest): MessagesAuthCandidate {
    const { ctx } = this
    const reference = connection.reference ?? MODEL_API_KEY
    const owner = connection.owner ?? request.consumer
    return {
      kind: 'api-key', endpoint, reference,
      configured: () => credentialRefConfigured(ctx, reference),
      resolve: async (signal) => {
        signal?.throwIfAborted()
        const raw = await resolveCredentialRef(ctx, reference)
        if (raw === undefined) return undefined
        const checked = normalizeApiKey(raw)
        if (!checked.ok) throw new MessagesAuthError(unusableKey(checked.reason, owner, reference), 'INVALID_CREDENTIAL')
        const headers: Record<string, string> = {}
        for (const header of request.apiKeyHeaders ?? ['authorization']) {
          headers[header] = header === 'authorization' ? `Bearer ${checked.value}` : checked.value
        }
        return { kind: 'api-key', endpoint, reference, headers }
      },
    }
  }
}

export default MessagesAuth
