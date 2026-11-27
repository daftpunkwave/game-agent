/**
 * Exclusive, non-blocking POSIX file locks.
 *
 * Responsibilities: Acquire an exclusive `flock` on an open file descriptor without blocking.
 * Contracts: `tryLockExclusive(fd)` resolves when the lock is held and rejects with a Node.js-style error whose
 * `code` is the system error name (for example `EWOULDBLOCK` or `EAGAIN` when another open file description holds
 * the lock). The lock lasts until the last descriptor of the open file description is closed. On platforms other
 * than Linux and macOS it rejects with `ERR_FLOCK_UNSUPPORTED_PLATFORM`.
 * Constraints: Calls the C library's `flock(2)` through the koffi foreign function interface, loaded once on first
 * use; never builds native code. `LOCK_NB` keeps the call from blocking the event loop.
 */
import { createRequire } from 'node:module'
import { getSystemErrorName } from 'node:util'

type Koffi = typeof import('koffi')
type FlockCall = (fd: number, operation: number) => number

const LOCK_EX = 2
const LOCK_NB = 4

/** C library file names to try, in order, per platform. */
const LIBC_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  linux: ['libc.so.6', 'libc.so'],
  darwin: ['libSystem.B.dylib', '/usr/lib/libSystem.B.dylib'],
}

let binding: { readonly koffi: Koffi; readonly flock: FlockCall } | undefined

function unsupported(): Error {
  return Object.assign(new Error(`flock is not supported on ${process.platform}-${process.arch}`), {
    code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM',
    syscall: 'flock',
  })
}

function loadBinding(): { readonly koffi: Koffi; readonly flock: FlockCall } {
  if (binding !== undefined) return binding
  const candidates = LIBC_CANDIDATES[process.platform]
  if (candidates === undefined) throw unsupported()
  const koffi = createRequire(import.meta.url)('koffi') as Koffi
  let lastError: unknown
  for (const name of candidates) {
    try {
      const flock = koffi.load(name).func('int flock(int fd, int operation)') as FlockCall
      binding = { koffi, flock }
      return binding
    } catch (error) {
      lastError = error
    }
  }
  throw Object.assign(new Error('flock: the C library could not be loaded', { cause: lastError }), {
    code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM',
    syscall: 'flock',
  })
}

/**
 * Try to take an exclusive lock on an open file descriptor.
 * @param fd - open file descriptor; keep it open while the lock is needed.
 * @returns a promise that resolves once the lock is held.
 */
export async function tryLockExclusive(fd: number): Promise<void> {
  const { koffi, flock } = loadBinding()
  if (flock(fd, LOCK_EX | LOCK_NB) === 0) return
  const errno = koffi.errno()
  const code = getSystemErrorName(-errno)
  throw Object.assign(new Error(`${code}: flock failed`), { code, errno, syscall: 'flock' })
}
