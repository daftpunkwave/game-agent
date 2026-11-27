/**
 * Responsibilities: Apply operator commands to a fleet document: batch creation, release, pause and resume, takeover leases, spending limits, template publishing, and rollout.
 * Contracts: Every mutating command appends an audit entry; template versions are immutable once published; staged rollout selects agents by a stable hash of their id.
 * Constraints: Pure with respect to I/O; time and ids are injected. Persistence is handled by `storage.ts`.
 */
import { validateTreeDefinition, type TreeDefinition } from '@game-agent/behavior-tree'
import type { JsonObject } from '@game-agent/contracts'
import { GameAgentError } from '@game-agent/error'
import type { Clock, IdSource } from '@game-agent/ports'
import type { AgentLifecycle, AgentProfile, FleetDocument, RolloutPolicy, TreeTemplateRecord } from './model.ts'

/** Parameters for creating agents; one spec may create many agents. */
export type AgentSpec = Omit<AgentProfile, 'agentId' | 'displayName' | 'status' | 'takeover' | 'createdAt' | 'updatedAt'> & {
  readonly namePrefix: string
}

/** Filter for {@link Fleet.list}. */
export interface AgentFilter {
  readonly region?: string
  readonly server?: string
  readonly status?: AgentLifecycle
}

/** FNV-1a hash mapped to 0..99, stable across processes. */
export function rolloutBucket(agentId: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 100
}

/** Operator-facing fleet model. */
export class Fleet {
  readonly document: FleetDocument
  private readonly clock: Clock
  private readonly ids: IdSource

  constructor(document: FleetDocument, clock: Clock, ids: IdSource) {
    this.document = document
    this.clock = clock
    this.ids = ids
  }

  /** Agents matching the filter. */
  list(filter: AgentFilter = {}): AgentProfile[] {
    return this.document.agents.filter(
      (agent) =>
        (filter.region === undefined || agent.realm.region === filter.region) &&
        (filter.server === undefined || agent.realm.server === filter.server) &&
        (filter.status === undefined || agent.status === filter.status),
    )
  }

  /** Look up one agent. */
  get(agentId: string): AgentProfile | undefined {
    return this.document.agents.find((agent) => agent.agentId === agentId)
  }

  /**
   * Create `count` agents from one spec.
   * @throws GameAgentError `UNKNOWN_TEMPLATE` when the pinned template version is not published.
   */
  create(spec: AgentSpec, count: number, operator: string): AgentProfile[] {
    if (!Number.isInteger(count) || count < 1) throw new GameAgentError('count must be a positive integer', 'INVALID_COUNT')
    if (this.template(spec.tree.templateId, spec.tree.version) === undefined) {
      throw new GameAgentError(`Template ${spec.tree.templateId}@${spec.tree.version} is not published`, 'UNKNOWN_TEMPLATE')
    }
    const now = this.clock.now()
    const { namePrefix, ...profile } = spec
    const created: AgentProfile[] = []
    for (let index = 0; index < count; index += 1) {
      const agentId = this.ids.next('agent')
      created.push({ ...profile, agentId, displayName: count === 1 ? namePrefix : `${namePrefix}-${index + 1}`, status: 'active', createdAt: now, updatedAt: now })
    }
    this.document.agents.push(...created)
    this.audit(operator, 'create', created.map((agent) => agent.agentId), { template: `${spec.tree.templateId}@${spec.tree.version}`, count })
    return created
  }

  /** Stop managing agents; their accounts return to ordinary player control. The profile is kept for audit. */
  release(agentIds: readonly string[], operator: string): AgentProfile[] {
    return this.update(agentIds, operator, 'release', {}, (agent) => {
      const { takeover: _takeover, ...rest } = agent
      return { ...rest, status: 'released' }
    })
  }

  /** Pause or resume agents. */
  setActive(agentIds: readonly string[], active: boolean, operator: string): AgentProfile[] {
    return this.update(agentIds, operator, active ? 'resume' : 'pause', {}, (agent) => {
      if (agent.status === 'released' || agent.status === 'takeover') {
        throw new GameAgentError(`Agent ${agent.agentId} is ${agent.status} and cannot be ${active ? 'resumed' : 'paused'}`, 'INVALID_LIFECYCLE')
      }
      return { ...agent, status: active ? 'active' : 'paused' }
    })
  }

  /** Hand an agent's account to a human operator; the runtime must stop acting until the lease ends. */
  beginTakeover(agentId: string, operator: string): AgentProfile {
    const [agent] = this.update([agentId], operator, 'takeover.begin', {}, (current) => {
      if (current.status === 'released' || current.status === 'takeover') throw new GameAgentError(`Agent ${agentId} is ${current.status}`, 'INVALID_LIFECYCLE')
      return { ...current, status: 'takeover', takeover: { operator, since: this.clock.now() } }
    })
    return agent as AgentProfile
  }

  /** Return an agent to automated control; the runtime must re-read the game state before acting. */
  endTakeover(agentId: string, operator: string): AgentProfile {
    const [agent] = this.update([agentId], operator, 'takeover.end', {}, (current) => {
      if (current.status !== 'takeover') throw new GameAgentError(`Agent ${agentId} is not under takeover`, 'INVALID_LIFECYCLE')
      const { takeover: _takeover, ...rest } = current
      return { ...rest, status: 'active' }
    })
    return agent as AgentProfile
  }

  /** Change spending limits. */
  adjustSpending(agentIds: readonly string[], limits: { readonly dailyLimit?: number; readonly totalLimit?: number }, operator: string): AgentProfile[] {
    for (const value of [limits.dailyLimit, limits.totalLimit]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new GameAgentError('spending limits must be non-negative numbers', 'INVALID_LIMIT')
    }
    return this.update(agentIds, operator, 'spending.adjust', { ...limits }, (agent) => ({ ...agent, spending: { ...agent.spending, ...limits } }))
  }

  /**
   * Publish a validated tree version.
   * @throws GameAgentError `INVALID_TREE` or `VERSION_EXISTS`.
   */
  publishTemplate(definition: unknown, operator: string): TreeTemplateRecord {
    const validation = validateTreeDefinition(definition)
    if (!validation.ok) {
      throw new GameAgentError(`Tree is invalid: ${validation.problems.map((problem) => `${problem.path} ${problem.message}`).join('; ')}`, 'INVALID_TREE')
    }
    const tree: TreeDefinition = validation.tree
    if (this.template(tree.id, tree.version) !== undefined) throw new GameAgentError(`Template ${tree.id}@${tree.version} already exists`, 'VERSION_EXISTS')
    const record: TreeTemplateRecord = { templateId: tree.id, version: tree.version, publishedAt: this.clock.now(), publishedBy: operator, definition: tree }
    this.document.templates.push(record)
    this.audit(operator, 'template.publish', [], { template: `${tree.id}@${tree.version}` })
    return record
  }

  /** Look up a published template version. */
  template(templateId: string, version: number): TreeTemplateRecord | undefined {
    return this.document.templates.find((record) => record.templateId === templateId && record.version === version)
  }

  /** Change how agents on a template move to newer versions. */
  setRollout(templateId: string, policy: RolloutPolicy, operator: string): void {
    if (policy.kind === 'staged') {
      if (this.template(templateId, policy.targetVersion) === undefined) throw new GameAgentError(`Template ${templateId}@${policy.targetVersion} is not published`, 'UNKNOWN_TEMPLATE')
      if (!Number.isInteger(policy.percent) || policy.percent < 0 || policy.percent > 100) throw new GameAgentError('percent must be an integer between 0 and 100', 'INVALID_ROLLOUT')
    }
    this.document.rollouts[templateId] = policy
    this.audit(operator, 'template.rollout', [], { templateId, ...policy })
  }

  /** Tree version an agent should run under the current rollout policy. */
  effectiveTreeVersion(agent: AgentProfile): number {
    const policy = this.document.rollouts[agent.tree.templateId]
    if (policy?.kind === 'staged' && policy.targetVersion > agent.tree.version && rolloutBucket(agent.agentId) < policy.percent) return policy.targetVersion
    return agent.tree.version
  }

  private update(
    agentIds: readonly string[],
    operator: string,
    action: string,
    detail: JsonObject,
    change: (agent: AgentProfile) => AgentProfile,
  ): AgentProfile[] {
    const wanted = new Set(agentIds)
    const missing = agentIds.filter((agentId) => this.get(agentId) === undefined)
    if (missing.length > 0) throw new GameAgentError(`Unknown agents: ${missing.join(', ')}`, 'UNKNOWN_AGENT')
    const now = this.clock.now()
    const changed: AgentProfile[] = []
    this.document.agents.forEach((agent, index) => {
      if (!wanted.has(agent.agentId)) return
      const next = { ...change(agent), updatedAt: now }
      this.document.agents[index] = next
      changed.push(next)
    })
    this.audit(operator, action, agentIds, detail)
    return changed
  }

  private audit(operator: string, action: string, agentIds: readonly string[], detail: JsonObject): void {
    this.document.audit.push({ at: this.clock.now(), operator, action, agentIds: [...agentIds], detail })
  }
}
