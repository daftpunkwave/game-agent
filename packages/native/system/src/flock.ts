/**
 * Exclusive, non-blocking POSIX file locks through a native binding.
 *
 * Responsibilities: Acquire an exclusive `flock` on an open file descriptor without blocking.
 * Contracts: `tryLockExclusive(fd)` resolves when the lock is held and rejects with a Node.js-style error whose
 * `code` is the system error name (for example `EWOULDBLOCK` when another descriptor holds the lock). The lock lasts
 * until the last descriptor of the open file description is closed. On platforms other than Linux and macOS, or
 * when the platform helper package `@game-agent/native-system-<platform>-<arch>` is not installed, it rejects with
 * `ERR_FLOCK_UNSUPPORTED_PLATFORM` or the module resolution error.
 * Constraints: Never builds or downloads native code; the binding is loaded once, on first use.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getSystemErrorName } from 'node:util'

interface FlockBinding {
  tryLock(fd: number, callback: (errno: number) => void): void
}

let binding: FlockBinding | undefined

function loadBinding(): FlockBinding {
  if (binding !== undefined) return binding
  const { platform, arch } = process
  if (platform !== 'linux' && platform !== 'darwin') {
    throw Object.assign(new Error(`flock is not supported on ${platform}-${arch}`), {
      code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM',
      syscall: 'flock',
    })
  }
  let filename = 'system.node'
  if (platform === 'linux') {
    const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } }
    filename = join(report.header.glibcVersionRuntime !== undefined ? 'glibc' : 'musl', filename)
  }
  const require = createRequire(import.meta.url)
  const manifest = require.resolve(`@game-agent/native-system-${platform}-${arch}/package.json`)
  binding = require(join(dirname(manifest), 'bin', filename)) as FlockBinding
  return binding
}

/**
 * Try to take an exclusive lock on an open file descriptor.
 * @param fd - open file descriptor; keep it open while the lock is needed.
 * @returns a promise that resolves once the lock is held.
 */
export async function tryLockExclusive(fd: number): Promise<void> {
  const errno = await new Promise<number>((resolve) => {
    loadBinding().tryLock(fd, resolve)
  })
  if (errno === 0) return
  const code = getSystemErrorName(-errno)
  throw Object.assign(new Error(`${code}: flock failed`), { code, errno, syscall: 'flock' })
}
