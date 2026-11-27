/** Branded identifier shared by the records of one compaction. */
import type { Branded } from '@game-agent/brand'

/** Stable identity shared by one compact start/summary/checkpoint/end transaction. */
export type CompactionId = Branded<'CompactionId'>

/**
 * Brand an implementation-minted compaction identity.
 * @param id - opaque transaction identity.
 * @returns the same string, branded; no validation is performed.
 */
export function CompactionId(id: string): CompactionId {
  return id as CompactionId
}
