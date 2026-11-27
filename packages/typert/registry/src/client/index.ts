/** Browser face of the shared Typert runtime registry. */

import type { Context } from '@game-agent/kernel'
import { TypertRegistry } from '../service.ts'

/** Required services: none; this is the Client reflection root. */
export const inject: string[] = []

/**
 * Install the same registry implementation used by the Host face.
 * @param ctx - Client Kernel root.
 */
export function apply(ctx: Context): void {
  new TypertRegistry(ctx)
}
