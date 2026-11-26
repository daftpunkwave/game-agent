/**
 * Responsibilities: Enforce per-agent daily action quotas, overall and per action.
 * Contracts: `consume` records usage only when allowed; days roll over at the configured offset from UTC midnight.
 * Constraints: Time comes from the injected Clock; usage for past days is discarded on access.
 */
import type { Clock } from '@game-agent/ports'

const DAY_MS = 86_400_000

/** Daily limits for one agent. */
export interface QuotaPolicy {
  readonly dailyTotal?: number
  readonly dailyPerAction?: Readonly<Record<string, number>>
  /** Minutes added to UTC before computing the day boundary (480 = UTC+8 midnight). */
  readonly dayOffsetMinutes?: number
}

/** Outcome of a quota check. */
export type QuotaDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly scope: 'total' | 'action'; readonly limit: number; readonly used: number }

interface DayUsage {
  day: number
  total: number
  perAction: Map<string, number>
}

/** Daily quota tracker for any number of agents. */
export class QuotaLimiter {
  private readonly usage = new Map<string, DayUsage>()
  private readonly policy: QuotaPolicy
  private readonly clock: Clock

  constructor(policy: QuotaPolicy, clock: Clock) {
    this.policy = policy
    this.clock = clock
  }

  /** Check without consuming. */
  check(agentId: string, action: string): QuotaDecision {
    const usage = this.usageFor(agentId)
    if (this.policy.dailyTotal !== undefined && usage.total >= this.policy.dailyTotal) {
      return { allowed: false, scope: 'total', limit: this.policy.dailyTotal, used: usage.total }
    }
    const actionLimit = this.policy.dailyPerAction?.[action]
    const actionUsed = usage.perAction.get(action) ?? 0
    if (actionLimit !== undefined && actionUsed >= actionLimit) {
      return { allowed: false, scope: 'action', limit: actionLimit, used: actionUsed }
    }
    return { allowed: true }
  }

  /** Check and, when allowed, record one use. */
  consume(agentId: string, action: string): QuotaDecision {
    const decision = this.check(agentId, action)
    if (!decision.allowed) return decision
    const usage = this.usageFor(agentId)
    usage.total += 1
    usage.perAction.set(action, (usage.perAction.get(action) ?? 0) + 1)
    return decision
  }

  private usageFor(agentId: string): DayUsage {
    const day = Math.floor((this.clock.now() + (this.policy.dayOffsetMinutes ?? 0) * 60_000) / DAY_MS)
    const current = this.usage.get(agentId)
    if (current !== undefined && current.day === day) return current
    const fresh: DayUsage = { day, total: 0, perAction: new Map() }
    this.usage.set(agentId, fresh)
    return fresh
  }
}
