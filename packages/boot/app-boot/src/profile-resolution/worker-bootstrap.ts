/** Install the inherited runtime resolution in one Runtime-owned Worker. */

import { getEnvironmentData } from 'node:worker_threads'
import { installRuntimeInterception } from './resolver.ts'
import type { RuntimeResolution } from '../profile.ts'

const registration = getEnvironmentData(
  '@game-agent/app-boot/profile-resolution',
) as {
  resolution: RuntimeResolution
} | undefined
if (registration !== undefined) installRuntimeInterception(registration.resolution)
