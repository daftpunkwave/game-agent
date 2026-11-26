/**
 * Responsibilities: Shared CLI plumbing: output sink, JSON file loading, and option helpers.
 * Contracts: Commands write through `Output` so tests can capture text; `CliError` carries a user-facing message and exit code.
 * Constraints: No business logic; parsing helpers only convert and validate strings.
 */
import { readFile } from 'node:fs/promises'
import { GameAgentError } from '@game-agent/errors'

/** Destination of command output. */
export interface Output {
  line(text: string): void
  json(value: unknown): void
}

/** Output written to the process streams. */
export const processOutput: Output = {
  line: (text) => {
    process.stdout.write(`${text}\n`)
  },
  json: (value) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  },
}

/** Error shown to the user without a stack trace. */
export class CliError extends GameAgentError {
  constructor(message: string) {
    super(message, 'CLI_USAGE')
  }
}

/** Read and parse a JSON file. */
export async function readJsonFile(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new CliError(`Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new CliError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Require a string option. */
export function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value === '') throw new CliError(`--${name} is required`)
  return value
}

/** Parse a non-negative number option. */
export function numberOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new CliError(`--${name} must be a non-negative number`)
  return parsed
}

/** Split a comma-separated option into trimmed, non-empty items. */
export function listOption(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}
