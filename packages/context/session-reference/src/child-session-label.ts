/**
 * Projection that labels a delegated child session.
 *
 * A delegation plugin that runs child sessions contributes the `subagent` projection; mention labels prefer it over
 * the session title. When no such plugin is installed the projection is absent and titles are used.
 */
import type { SessionSeq } from '@game-agent/session/types'

/** Identity of a delegated child session, or `null` when the session has no valid child descriptor. */
export type ChildSessionIdentity =
  | { mode: 'one-shot'; label?: string; seq: SessionSeq }
  | { mode: 'continuable'; label: string; seq: SessionSeq }

declare module '@game-agent/session-projection/types' {
  interface SessionProjectionMap {
    /** Identity of a delegated child session; contributed by a delegation plugin when one is installed. */
    subagent: ChildSessionIdentity | null
  }
}
