/**
 * Responsibilities: Verify batch creation, lifecycle commands, takeover leases, template immutability, staged rollout, audit, and file round-trips.
 * Contracts: Uses ManualClock and SequentialIds; storage tests write into a fresh temporary directory.
 * Constraints: The temporary directory is removed after the test.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TREE_FORMAT, type TreeDefinition } from '@game-agent/behavior-tree'
import { ManualClock, SequentialIds } from '@game-agent/ports'
import { Fleet, emptyFleet, loadFleetDocument, rolloutBucket, saveFleetDocument, type AgentSpec } from '../src/index.ts'

const treeV1: TreeDefinition = { format: TREE_FORMAT, id: 'daily', version: 1, root: { type: 'condition', check: 'always' } }

const spec: AgentSpec = {
  namePrefix: 'npc',
  realm: { region: 'qa', server: 's1' },
  account: 'account-ref',
  tree: { templateId: 'daily', version: 1 },
  persona: { risk: 'conservative', language: 'en', messagesPerDay: 12 },
  schedule: { utcOffsetMinutes: 480, windows: [{ start: '08:00', end: '12:00' }] },
  spending: { currency: 'premium', dailyLimit: 100, totalLimit: 1000 },
}

function createFleet(): Fleet {
  const fleet = new Fleet(emptyFleet(), new ManualClock(1000), new SequentialIds())
  fleet.publishTemplate(treeV1, 'ops')
  return fleet
}

let temporary: string | undefined
afterEach(async () => {
  if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
  temporary = undefined
})

describe('Fleet', () => {
  it('creates agents in batches from a published template and audits it', () => {
    const fleet = createFleet()
    const created = fleet.create(spec, 3, 'ops')
    expect(created.map((agent) => `${agent.agentId}:${agent.displayName}:${agent.status}`)).toEqual(['agent_1:npc-1:active', 'agent_2:npc-2:active', 'agent_3:npc-3:active'])
    expect(fleet.document.audit.at(-1)).toMatchObject({ operator: 'ops', action: 'create', agentIds: ['agent_1', 'agent_2', 'agent_3'] })
    expect(() => fleet.create({ ...spec, tree: { templateId: 'daily', version: 9 } }, 1, 'ops')).toThrowError(/not published/)
  })

  it('enforces lifecycle rules for pause, takeover, and release', () => {
    const fleet = createFleet()
    const [agent] = fleet.create(spec, 1, 'ops')
    const agentId = agent?.agentId as string
    fleet.beginTakeover(agentId, 'gm-1')
    expect(fleet.get(agentId)).toMatchObject({ status: 'takeover', takeover: { operator: 'gm-1', since: 1000 } })
    expect(() => fleet.setActive([agentId], false, 'ops')).toThrowError(/takeover/)
    fleet.endTakeover(agentId, 'gm-1')
    fleet.release([agentId], 'ops')
    expect(fleet.get(agentId)?.status).toBe('released')
    expect(fleet.get(agentId)?.takeover).toBeUndefined()
    expect(() => fleet.release(['ghost'], 'ops')).toThrowError(/Unknown agents: ghost/)
  })

  it('keeps template versions immutable and moves only the staged share of agents', () => {
    const fleet = createFleet()
    const agents = fleet.create(spec, 40, 'ops')
    expect(() => fleet.publishTemplate(treeV1, 'ops')).toThrowError(/already exists/)
    expect(() => fleet.publishTemplate({ ...treeV1, version: 2, root: { type: 'unknown' } }, 'ops')).toThrowError(/Tree is invalid/)
    fleet.publishTemplate({ ...treeV1, version: 2 }, 'ops')

    expect(agents.every((agent) => fleet.effectiveTreeVersion(agent) === 1)).toBe(true)
    fleet.setRollout('daily', { kind: 'staged', targetVersion: 2, percent: 25 }, 'ops')
    const moved = agents.filter((agent) => fleet.effectiveTreeVersion(agent) === 2)
    expect(moved.map((agent) => agent.agentId)).toEqual(agents.filter((agent) => rolloutBucket(agent.agentId) < 25).map((agent) => agent.agentId))
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.length).toBeLessThan(agents.length)
  })

  it('round-trips through a fleet file', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'game-agent-fleet-'))
    const path = join(temporary, 'fleet.json')
    expect(await loadFleetDocument(path)).toEqual(emptyFleet())
    const fleet = createFleet()
    fleet.create(spec, 2, 'ops')
    await saveFleetDocument(path, fleet.document)
    const loaded = await loadFleetDocument(path)
    expect(loaded.agents.map((agent) => agent.agentId)).toEqual(['agent_1', 'agent_2'])
    expect(loaded.templates).toHaveLength(1)
  })
})
