/** API-key authentication and credential-gated model discovery for the Messages API route. */
import type { Context } from '@game-agent/kernel'
import { INVALID_CREDENTIAL_CODE, LlmError } from '@game-agent/llm'
import type {} from '@game-agent/kernel-loader'
import { MessagesAuthError } from '@game-agent/messages-auth'
import { launchEnvironmentOf } from '@game-agent/launch-environment'
import { catalogModelInfo, registerMessagesProvider } from '@game-agent/llm-messages'
import type { MessagesRequestAuth } from '@game-agent/llm-messages'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedMessagesOptions } from './config.ts'

export { Config } from './config.ts'
export type { Options, ResolvedMessagesOptions } from './config.ts'
export const name = 'llm-messages-api-key'
export const inject = ['llm', 'messagesAuth']

const PROVIDER = 'messages'

export function apply(ctx: Context, config: Config): void {
  /** Settings namespace of this mount, which the provider directory lists and credential diagnostics name. */
  const settingsNs = ctx.fiber.entry?.options.id ?? name
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()
  // Every other consumer billed by the API key sends this route's key to this route's deployment.
  ctx.effect(() => ctx.messagesAuth.connect('api-key', PROVIDER, () => {
    const connection = options()
    return { baseURL: connection.baseURL, reference: connection.apiKeyEnv, owner: settingsNs }
  }), 'llm-messages-api-key: API-key deployment')
  /**
   * The key `ctx.messagesAuth` releases for `endpoint` from one configuration generation, in the header Messages
   * expects; `undefined` when none is configured or `endpoint` is outside the route's deployment. An unusable key fails
   * as this route's `INVALID_CREDENTIAL`; store failures propagate.
   */
  const resolveAuth = async (connection: ResolvedMessagesOptions, endpoint: string): Promise<MessagesRequestAuth | undefined> => {
    try {
      return await ctx.messagesAuth.authorize({
        consumer: settingsNs, accepts: ['api-key'], billing: 'api-key', destination: { url: endpoint },
        connections: { 'api-key': { baseURL: connection.baseURL, reference: connection.apiKeyEnv } },
        apiKeyHeaders: ['x-api-key'],
      })
    } catch (error) {
      if (error instanceof MessagesAuthError && error.code === 'INVALID_CREDENTIAL') {
        throw new LlmError(error.message, INVALID_CREDENTIAL_CODE, { cause: error })
      }
      throw error
    }
  }
  const missingCredential = (connection: ResolvedMessagesOptions) => new LlmError(
    `llm-messages: no API key for provider route "${PROVIDER}"; store ${connection.apiKeyEnv} through the credentials`
    + ` service (the web Models page writes it), or export ${connection.apiKeyEnv} in the launching environment`,
    'MISSING_CREDENTIAL',
  )
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Messages API', settingsNs, settingsPath: [] },
  ])
  registerMessagesProvider<ResolvedMessagesOptions>(ctx, PROVIDER, {
    providerName: 'Messages API',
    options,
    resolveAuth,
    missingCredential,
    discoverModels: async (provider) => {
      const connection = options()
      if (await resolveAuth(connection, connection.baseURL) === undefined) return []
      return connection.models.map(model => catalogModelInfo(provider, model))
    },
  })
}
