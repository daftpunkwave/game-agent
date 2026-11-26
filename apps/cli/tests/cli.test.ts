/**
 * Responsibilities: Verify the CLI end to end: tree validation and outline, a deterministic simulation of the example tree, and fleet operations on a file.
 * Contracts: Calls `main` in-process with a capturing output; fleet tests use a fresh temporary directory.
 * Constraints: No network access; the `run` command is not exercised here because it needs a live game and model.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../src/main.ts'
import type { Output } from '../src/io.ts'

const EXAMPLE_TREE = resolve(import.meta.dirname, '../../../examples/simulated-farm/tree.json')

function capture(): Output & { lines: string[]; values: unknown[] } {
  const lines: string[] = []
  const values: unknown[] = []
  return { lines, values, line: (text) => lines.push(text), json: (value) => values.push(value) }
}

let temporary: string | undefined
afterEach(async () => {
  if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
  temporary = undefined
})

describe('game-agent CLI', () => {
  it('validates and outlines tree files', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'game-agent-cli-'))
    const broken = join(temporary, 'broken.json')
    await writeFile(broken, JSON.stringify({ format: 'game-agent.tree/v1', id: 'x', version: 1, root: { type: 'sequence', children: [] } }))
    const out = capture()
    expect(await main(['tree', 'validate', EXAMPLE_TREE, broken], out)).toBe(1)
    expect(out.lines[0]).toMatch(/^ok {4}.*simulated-farm@1$/)
    expect(out.lines.slice(1)).toEqual([`error ${broken}`, '      root: children must be a non-empty array'])

    const outline = capture()
    expect(await main(['tree', 'outline', EXAMPLE_TREE], outline)).toBe(0)
    expect(outline.lines).toContain('    selector  (root/0)')
    expect(outline.lines).toContain('      cooldown "consult the model at most hourly"  (root/0/2)')
    expect(outline.lines).toContain('        decision [gather, say]  (root/0/2/0)')
  })

  it('simulates the example tree deterministically on an accelerated clock', async () => {
    const run = async () => {
      const out = capture()
      expect(await main(['simulate', '--tree', EXAMPLE_TREE, '--hours', '8', '--step-minutes', '5', '--json'], out)).toBe(0)
      return out.values[0] as { summary: { steps: number; decisions: number; counts: Record<string, number>; city: Record<string, unknown> } }
    }
    const first = await run()
    const second = await run()
    expect(second).toEqual(first)
    expect(first.summary.steps).toBe(96)
    expect(first.summary.counts['intent.accepted']).toBeGreaterThanOrEqual(1)
    expect(first.summary.counts['farm.upgraded']).toBeGreaterThanOrEqual(1)
    expect(first.summary.decisions).toBeGreaterThanOrEqual(1)
    expect(first.summary.counts['intent.rejected']).toBeUndefined()
    expect(Object.keys(first.summary.city).sort()).toEqual(['city.farmLevel', 'city.food', 'city.upgradeCost', 'city.upgrading', 'city.wood'])
  })

  it('manages a fleet file with audit', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'game-agent-cli-'))
    const file = join(temporary, 'fleet.json')
    const out = capture()
    expect(await main(['fleet', 'publish', '--file', file, '--tree', EXAMPLE_TREE, '--operator', 'ops'], out)).toBe(0)
    expect(
      await main(
        ['fleet', 'create', '--file', file, '--operator', 'ops', '--template', 'simulated-farm@1', '--count', '2', '--region', 'qa', '--server', 's1', '--account', 'pool-a', '--risk', 'aggressive', '--active', '08:00-12:00,19:00-23:00', '--daily-limit', '50'],
        out,
      ),
    ).toBe(0)
    const list = capture()
    expect(await main(['fleet', 'list', '--file', file, '--json'], list)).toBe(0)
    const agents = list.values[0] as { agentId: string; persona: { risk: string }; schedule: { windows: unknown[] } }[]
    expect(agents).toHaveLength(2)
    expect(agents[0]?.persona.risk).toBe('aggressive')
    expect(agents[0]?.schedule.windows).toEqual([{ start: '08:00', end: '12:00' }, { start: '19:00', end: '23:00' }])

    const failure = capture()
    expect(await main(['fleet', 'handback', '--file', file, '--agent', agents[0]?.agentId ?? ''], failure)).toBe(2)
    expect(failure.lines[0]).toMatch(/is not under takeover/)
  })

  it('prints help and rejects unknown commands', async () => {
    const out = capture()
    expect(await main(['help'], out)).toBe(0)
    expect(out.lines[0]).toMatch(/^game-agent: run language-model agents/)
    expect(await main(['launch'], capture())).toBe(2)
  })
})
