/**
 * Import-free type declarations of the `workingDirectory` Session projection, for Client programs that read it.
 * @module @game-agent/working-directory/types
 */

import type {} from '@game-agent/session-projection/types'

declare module '@game-agent/session-projection/types' {
  interface SessionProjectionMap {
    /** Recorded directory of the Session for observations, or null when none is recorded. */
    workingDirectory: string | null
  }
}
