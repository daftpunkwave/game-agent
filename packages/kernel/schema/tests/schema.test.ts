/**
 * Responsibilities: Verify that object schemas apply defaults and reject values of the wrong type.
 * Contracts: Pure validation calls; no I/O.
 * Constraints: Exercises only the public schema API.
 */
import { describe, expect, it } from 'vitest'
import Schema from '../src/index.ts'

describe('schema', () => {
  it('applies defaults to missing fields', () => {
    const config = Schema.object({ limit: Schema.natural().default(3), name: Schema.string().default('npc') })
    expect(config({})).toEqual({ limit: 3, name: 'npc' })
  })

  it('rejects a value of the wrong type', () => {
    const config = Schema.object({ limit: Schema.natural() })
    expect(() => config({ limit: 'many' } as unknown as { limit: number })).toThrow()
  })
})
