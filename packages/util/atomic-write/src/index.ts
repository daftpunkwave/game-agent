/**
 * Responsibilities: Replace a file atomically so concurrent readers observe either the previous or the next complete content.
 * Contracts: Writes a random-suffix sibling with exclusive create and the requested mode, then renames it over the target.
 * Constraints: Crash durability (fsync) is out of scope; Windows transient rename failures are retried a bounded number of times.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const WINDOWS_TRANSIENT_RENAME_ERRORS: ReadonlySet<string> = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_INITIAL_MS = 20
const RENAME_RETRY_MAX_MS = 200
const RENAME_RETRY_LIMIT = 8

/** Permission options for {@link writeFileAtomic}; `mode` is required so the decision stays visible at call sites. */
export interface WriteFileAtomicOptions {
  /** Permission bits stamped on the replacement file (subject to the process umask). */
  mode: number
  /** Permission bits for parent directories created by this call. */
  dirMode?: number
}

function isTransientWindowsRenameError(error: unknown): boolean {
  if (process.platform !== 'win32') return false
  return WINDOWS_TRANSIENT_RENAME_ERRORS.has((error as NodeJS.ErrnoException | null)?.code ?? '')
}

async function renameWithRetry(temp: string, target: string): Promise<void> {
  let delay = RENAME_RETRY_INITIAL_MS
  for (let retries = 0; ; retries += 1) {
    try {
      await rename(temp, target)
      return
    } catch (error) {
      if (!isTransientWindowsRenameError(error) || retries >= RENAME_RETRY_LIMIT) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, RENAME_RETRY_MAX_MS)
  }
}

/**
 * Replace `filename` with `content` in one atomic step, creating parent directories.
 * The temporary sibling is opened with exclusive create so a planted symlink is never followed,
 * and it lives in the same directory so the rename never crosses filesystems.
 * @param filename - final path receiving the content.
 * @param content - complete next file content.
 * @param options - permission bits for the replacement file.
 */
export async function writeFileAtomic(
  filename: string,
  content: string | Uint8Array,
  options: WriteFileAtomicOptions,
): Promise<void> {
  await mkdir(dirname(filename), {
    recursive: true,
    ...(options.dirMode === undefined ? {} : { mode: options.dirMode }),
  })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode: options.mode, flag: 'wx' })
    await renameWithRetry(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
