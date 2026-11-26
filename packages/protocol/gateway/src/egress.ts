/**
 * Responsibilities: Single exit for every command: validate, enforce quota, record in the ledger, apply human-like jitter, send, and apply the receipt.
 * Contracts: A refused command never reaches the transport; a send that throws leaves the intent `in-doubt`, never `failed`.
 * Constraints: No automatic retries. Time, randomness, ids, and waiting come from injected ports.
 */
import type { ActionSpec, IntentSource, JsonObject, TransportAdapter } from '@game-agent/contracts'
import { validateJson } from '@game-agent/contracts'
import type { IntentLedger, LedgerEntry } from '@game-agent/intent-ledger'
import type { Clock, IdSource, Rng } from '@game-agent/ports'
import type { TraceSink } from '@game-agent/trace'
import type { QuotaLimiter } from './quota.ts'

/** A command proposed by a behavior tree, a model decision, or an operator. */
export interface ProposedCommand {
  readonly agentId: string
  readonly action: string
  readonly args: JsonObject
  readonly source: IntentSource
}

/** Why a command was refused before reaching the game. */
export type RefusalCode = 'UNKNOWN_ACTION' | 'INVALID_ARGS' | 'QUOTA_EXHAUSTED' | 'CANCELLED'

/** Result of dispatching one command. */
export type DispatchOutcome =
  | { readonly kind: 'dispatched'; readonly entry: LedgerEntry }
  | { readonly kind: 'refused'; readonly code: RefusalCode; readonly detail: string }
  | { readonly kind: 'in-doubt'; readonly entry: LedgerEntry }

/** Delay range applied before each send. */
export interface JitterPolicy {
  readonly minMs: number
  readonly maxMs: number
}

/** Collaborators of the egress gateway. */
export interface EgressDependencies {
  readonly transport: TransportAdapter
  readonly ledger: IntentLedger
  readonly quota: QuotaLimiter
  readonly clock: Clock
  readonly rng: Rng
  readonly ids: IdSource
  readonly jitter: JitterPolicy
  /** Wait for the given duration; rejects when the signal aborts. */
  readonly delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly trace: TraceSink
}

/** Outbound gateway for one agent or shard. */
export class EgressGateway {
  private catalog = new Map<string, ActionSpec>()
  private readonly deps: EgressDependencies

  constructor(deps: EgressDependencies) {
    this.deps = deps
  }

  /** Replace the set of actions the game currently accepts. */
  setCatalog(actions: readonly ActionSpec[]): void {
    this.catalog = new Map(actions.map((action) => [action.name, action]))
  }

  /** Actions currently accepted, sorted by name for stable prompt ordering. */
  actions(): ActionSpec[] {
    return [...this.catalog.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Run one command through every stage. */
  async dispatch(command: ProposedCommand, signal?: AbortSignal): Promise<DispatchOutcome> {
    const spec = this.catalog.get(command.action)
    if (spec === undefined) return this.refuse(command, 'UNKNOWN_ACTION', `action ${command.action} is not offered by the game`)
    const violations = validateJson(spec.parameters, command.args)
    if (violations.length > 0) {
      return this.refuse(command, 'INVALID_ARGS', violations.map((item) => `${item.path} ${item.message}`).join('; '))
    }
    const quota = this.deps.quota.consume(command.agentId, command.action)
    if (!quota.allowed) {
      return this.refuse(command, 'QUOTA_EXHAUSTED', `${quota.scope} quota ${quota.used}/${quota.limit} used today`)
    }

    const intentId = this.deps.ids.next('intent')
    const entry = this.deps.ledger.record({
      intentId,
      agentId: command.agentId,
      action: command.action,
      args: command.args,
      source: command.source,
      issuedAt: this.deps.clock.now(),
      idempotencyKey: `${command.agentId}:${intentId}`,
    })

    const { minMs, maxMs } = this.deps.jitter
    try {
      await this.deps.delay(minMs + this.deps.rng.next() * Math.max(0, maxMs - minMs), signal)
    } catch {
      this.deps.ledger.cancelUnsent(intentId, 'cancelled before send')
      return this.refuse(command, 'CANCELLED', 'dispatch was cancelled before the command was sent')
    }

    this.deps.ledger.markSent(intentId)
    try {
      const receipt = await this.deps.transport.send(entry.intent, signal)
      this.deps.ledger.applyReceipt(intentId, receipt)
      this.traceIntent(entry, spec, `intent.${receipt.kind}`)
      return { kind: 'dispatched', entry }
    } catch (error) {
      this.deps.ledger.markInDoubt(intentId, error instanceof Error ? error.message : String(error))
      this.traceIntent(entry, spec, 'intent.in-doubt')
      return { kind: 'in-doubt', entry }
    }
  }

  private refuse(command: ProposedCommand, code: RefusalCode, detail: string): DispatchOutcome {
    this.deps.trace.write({
      at: this.deps.clock.now(),
      agentId: command.agentId,
      category: 'intent',
      name: 'intent.refused',
      tags: this.catalog.get(command.action)?.tags ?? [],
      detail: { action: command.action, source: command.source, code, detail },
    })
    return { kind: 'refused', code, detail }
  }

  private traceIntent(entry: LedgerEntry, spec: ActionSpec, name: string): void {
    this.deps.trace.write({
      at: this.deps.clock.now(),
      agentId: entry.intent.agentId,
      category: 'intent',
      name,
      tags: spec.tags ?? [],
      detail: {
        intentId: entry.intent.intentId,
        action: entry.intent.action,
        source: entry.intent.source,
        state: entry.state,
        ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
      },
    })
  }
}
