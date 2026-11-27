/** Facts about the host process that platform checks depend on. */

import { release } from 'node:os'

/** Process and kernel facts; omitted fields describe the current process. */
export interface HostEnvironmentFacts {
  /** `process.platform` value to evaluate. */
  platform?: string
  /** Environment to inspect. */
  env?: NodeJS.ProcessEnv
  /** Kernel release string, as returned by `os.release()`. */
  osRelease?: string
}

/**
 * Tell whether a Linux process runs under Windows Subsystem for Linux.
 * @param facts - process and kernel facts; omitted fields use the current process.
 * @returns true when WSL markers are present on a Linux host, even when interoperation is disabled.
 */
export function isWsl(facts: HostEnvironmentFacts = {}): boolean {
  if ((facts.platform ?? process.platform) !== 'linux') return false
  const env = facts.env ?? process.env
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP)
    || (facts.osRelease ?? release()).toLowerCase().includes('microsoft')
}
