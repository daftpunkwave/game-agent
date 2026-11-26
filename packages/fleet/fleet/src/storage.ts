/**
 * Responsibilities: Load and save the fleet document as a JSON file.
 * Contracts: A missing file yields an empty fleet; saves replace the file atomically; a file with a foreign format is rejected.
 * Constraints: No locking across processes; one operator process should own a fleet file at a time.
 */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@game-agent/atomic-write'
import { GameAgentError } from '@game-agent/errors'
import { FLEET_FORMAT, emptyFleet, type FleetDocument } from './model.ts'

/** Read a fleet document, or an empty one when the file does not exist. */
export async function loadFleetDocument(path: string): Promise<FleetDocument> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFleet()
    throw error
  }
  const parsed = JSON.parse(text) as Partial<FleetDocument>
  if (parsed.format !== FLEET_FORMAT) throw new GameAgentError(`${path} is not a ${FLEET_FORMAT} document`, 'INVALID_FLEET_FILE')
  return { ...emptyFleet(), ...parsed } as FleetDocument
}

/** Write a fleet document atomically with owner-only permissions. */
export async function saveFleetDocument(path: string, document: FleetDocument): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
