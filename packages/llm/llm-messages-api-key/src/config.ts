/** API-key configuration resolved together with one Messages endpoint generation. */
import type { Volatile } from '@game-agent/kernel'
import z from '@game-agent/schema'
import { credentialRef, type CredentialRef } from '@game-agent/credentials'
import type { LaunchEnvironmentSnapshot } from '@game-agent/launch-environment'
import {
  messagesConfigFields, plainOptions as protocolOptions, resolveAdapterOptions as resolveProtocolOptions,
} from '@game-agent/llm-messages'
import type { Config as ProtocolConfig, MessagesConnectionOptions, Options as ProtocolOptions } from '@game-agent/llm-messages'

/** Messages configuration with a per-request API-key reference. */
export interface Config extends ProtocolConfig {
  /** Credential reference resolved per request; defaults to MODEL_API_KEY. */
  apiKeyEnv: Volatile<string>
}
export const Config = z.object({
  ...messagesConfigFields,
  apiKeyEnv: z.string().role('credential-ref').default('MODEL_API_KEY').volatile(),
})
/** Plain deployment inputs for the API-key provider. */
export type Options = ProtocolOptions & { apiKeyEnv?: string }
/**
 * Endpoint and credential reference captured from the same configuration generation. The route follows no model
 * listing: its models are the catalog its settings name.
 */
export interface ResolvedMessagesOptions extends MessagesConnectionOptions {
  /** Credential reference used only for this connection snapshot. */
  apiKeyEnv: CredentialRef
}
/** Read one validated provider configuration.
 * @param config - live plugin configuration.
 * @returns detached resolver inputs.
 */
export function plainOptions(config: Config): Options {
  return { ...protocolOptions(config), apiKeyEnv: config.apiKeyEnv.get() }
}
/** Resolve API-key and protocol settings together.
 * @param config - raw deployment settings.
 * @param environment - application launch environment.
 * @returns validated endpoint facts and the matching credential reference.
 */
export function resolveAdapterOptions(config: Options, environment?: LaunchEnvironmentSnapshot): ResolvedMessagesOptions {
  const { apiKeyEnv, ...messages } = config
  return { ...resolveProtocolOptions(messages, environment), apiKeyEnv: credentialRef(apiKeyEnv ?? 'MODEL_API_KEY') }
}
