/**
 * Responsibilities: Define the persistent fleet model: agent profiles, tree template versions, rollout policies, and the operator audit log.
 * Contracts: A profile pins one tree template version; persona, schedule, and spending limits are per-agent parameters, not prompt text.
 * Constraints: Type and constant module only; the document is plain JSON so operators can inspect and diff it.
 */
import type { TreeDefinition } from '@game-agent/behavior-tree'
import type { JsonObject } from '@game-agent/contracts'

/** Format tag of the fleet document. */
export const FLEET_FORMAT = 'game-agent.fleet/v1'

/** Willingness to take risks; drives thresholds in rule nodes and tone in decisions. */
export type RiskAppetite = 'aggressive' | 'balanced' | 'conservative'

/** Lifecycle of a managed agent. */
export type AgentLifecycle = 'active' | 'paused' | 'takeover' | 'released'

/** Daily active window in local `HH:MM`. */
export interface ActiveWindow {
  readonly start: string
  readonly end: string
}

/** Where the agent plays. */
export interface RealmRef {
  /** Deployment region or environment, e.g. `cn`, `global`, `qa`. */
  readonly region: string
  readonly server: string
}

/** Stable behavioral parameters sampled once per agent. */
export interface Persona {
  readonly risk: RiskAppetite
  readonly language: string
  /** Upper bound on chat messages per day. */
  readonly messagesPerDay: number
  /** Optional goal weights such as `{ expand: 0.4, defend: 0.3 }`. */
  readonly goals?: Readonly<Record<string, number>>
}

/** Limits on spending a premium or real-money-equivalent currency. */
export interface SpendingLimits {
  readonly currency: string
  readonly dailyLimit: number
  readonly totalLimit: number
}

/** One managed agent. */
export interface AgentProfile {
  readonly agentId: string
  readonly displayName: string
  readonly realm: RealmRef
  /** Reference to the game account; credentials are resolved by the deployment, never stored here. */
  readonly account: string
  readonly tree: { readonly templateId: string; readonly version: number }
  readonly persona: Persona
  readonly schedule: { readonly utcOffsetMinutes: number; readonly windows: readonly ActiveWindow[] }
  readonly spending: SpendingLimits
  readonly status: AgentLifecycle
  readonly takeover?: { readonly operator: string; readonly since: number }
  readonly createdAt: number
  readonly updatedAt: number
}

/** Published, immutable tree version. */
export interface TreeTemplateRecord {
  readonly templateId: string
  readonly version: number
  readonly publishedAt: number
  readonly publishedBy: string
  readonly definition: TreeDefinition
}

/**
 * How existing agents move to newer template versions.
 * `pinned` keeps each agent on its own version; `staged` moves a stable percentage of agents to `targetVersion`.
 */
export type RolloutPolicy = { readonly kind: 'pinned' } | { readonly kind: 'staged'; readonly targetVersion: number; readonly percent: number }

/** One operator action, kept for audit. */
export interface AuditEntry {
  readonly at: number
  readonly operator: string
  readonly action: string
  readonly agentIds: readonly string[]
  readonly detail: JsonObject
}

/** The complete persisted fleet. */
export interface FleetDocument {
  readonly format: typeof FLEET_FORMAT
  readonly agents: AgentProfile[]
  readonly templates: TreeTemplateRecord[]
  readonly rollouts: Record<string, RolloutPolicy>
  readonly audit: AuditEntry[]
}

/** Create an empty fleet document. */
export function emptyFleet(): FleetDocument {
  return { format: FLEET_FORMAT, agents: [], templates: [], rollouts: {}, audit: [] }
}
