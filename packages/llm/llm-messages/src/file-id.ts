/** Files API identifiers. @module llm-messages/file-id */

import type { Branded } from '@game-agent/brand'

/** Opaque identifier returned by the Files API. */
export type MessagesFileId = Branded<'MessagesFileId'>

/**
 * Brand a provider-returned file identifier after wire validation.
 * @param id - non-empty Files API identifier.
 * @returns the same string with its provider identity attached at type level.
 */
export function MessagesFileId(id: string): MessagesFileId {
  return id as MessagesFileId
}

/** Non-secret digest identifying one endpoint and API-key file namespace. */
export type MessagesFileScope = Branded<'MessagesFileScope'>

/**
 * Brand a locally derived namespace digest.
 * @param scope - SHA-256 digest of endpoint and API key.
 * @returns the same string with namespace identity attached at type level.
 */
export function MessagesFileScope(scope: string): MessagesFileScope {
  return scope as MessagesFileScope
}
