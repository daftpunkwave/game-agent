/**
 * Responsibilities: Track every command from issue to settlement so that an `accepted` receipt is never mistaken for a result.
 * Contracts: Settlement matches events to intents only by server-issued correlation id; unmatched events are reported as external.
 * Constraints: Never resends a command; overdue intents are reconciled by query only. Time comes from the injected Clock.
 */
import type { CommandReceipt, CommandStatus, GameIntent, JsonValue, RawGameEvent } from '@game-agent/contracts'
import { GameAgentError } from '@game-agent/error'
import type { Clock } from '@game-agent/ports'

/** Lifecycle state of one intent. */
export type IntentState =
  | 'recorded'
  | 'sent'
  | 'accepted'
  | 'overdue'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'in-doubt'
  | 'unknown'

const TERMINAL_STATES: ReadonlySet<IntentState> = new Set(['succeeded', 'failed', 'rejected', 'unknown'])

/** Allowed transitions; anything else is a programming error. */
const TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> = {
  recorded: ['sent', 'rejected'],
  sent: ['accepted', 'succeeded', 'rejected', 'in-doubt'],
  accepted: ['succeeded', 'failed', 'overdue'],
  overdue: ['accepted', 'succeeded', 'failed', 'unknown'],
  'in-doubt': ['succeeded', 'failed', 'unknown'],
  succeeded: [],
  failed: [],
  rejected: [],
  unknown: [],
}

/** One intent and everything the ledger knows about it. */
export interface LedgerEntry {
  readonly intent: GameIntent
  state: IntentState
  correlationId?: string
  acceptedAt?: number
  /** Time after which an accepted intent is considered overdue. */
  deadline?: number
  outcome?: JsonValue
  reason?: string
  readonly history: { state: IntentState; at: number }[]
}

/** Result of matching an inbound event against open intents. */
export type SettlementMatch =
  | { readonly kind: 'settled'; readonly entry: LedgerEntry }
  | { readonly kind: 'duplicate'; readonly entry: LedgerEntry }
  | { readonly kind: 'external' }

/** Timing policy for overdue detection. */
export interface LedgerOptions {
  readonly clock: Clock
  /** Minimum grace after the expected settle time. */
  readonly graceMs: number
  /** Additional grace as a fraction of the expected duration. */
  readonly graceRatio: number
  /** Deadline used when the game gives no expected settle time. */
  readonly defaultSettleMs: number
}

/** Command ledger for one agent or one shard of agents. */
export class IntentLedger {
  private readonly entries = new Map<string, LedgerEntry>()
  private readonly byCorrelation = new Map<string, string>()
  private readonly options: LedgerOptions

  constructor(options: LedgerOptions) {
    this.options = options
  }

  /**
   * Register a new intent before it is sent.
   * @throws GameAgentError `DUPLICATE_INTENT` when the id is already known.
   */
  record(intent: GameIntent): LedgerEntry {
    if (this.entries.has(intent.intentId)) {
      throw new GameAgentError(`Intent ${intent.intentId} is already recorded`, 'DUPLICATE_INTENT')
    }
    const entry: LedgerEntry = { intent, state: 'recorded', history: [{ state: 'recorded', at: this.options.clock.now() }] }
    this.entries.set(intent.intentId, entry)
    return entry
  }

  /** Mark an intent as handed to the transport. */
  markSent(intentId: string): LedgerEntry {
    return this.transition(this.require(intentId), 'sent')
  }

  /** Close an intent that was recorded but never handed to the transport. */
  cancelUnsent(intentId: string, reason: string): LedgerEntry {
    const entry = this.transition(this.require(intentId), 'rejected')
    entry.reason = reason
    return entry
  }

  /**
   * Record that sending failed after the command may have left the process.
   * The intent becomes `in-doubt`: the game may or may not have executed it.
   */
  markInDoubt(intentId: string, reason: string): LedgerEntry {
    const entry = this.transition(this.require(intentId), 'in-doubt')
    entry.reason = reason
    return entry
  }

  /** Apply the immediate receipt returned by the transport. */
  applyReceipt(intentId: string, receipt: CommandReceipt): LedgerEntry {
    const entry = this.require(intentId)
    switch (receipt.kind) {
      case 'completed':
        this.transition(entry, 'succeeded')
        entry.outcome = receipt.outcome
        return entry
      case 'rejected':
        this.transition(entry, 'rejected')
        entry.reason = receipt.reason
        return entry
      case 'accepted': {
        this.transition(entry, 'accepted')
        const now = this.options.clock.now()
        entry.correlationId = receipt.correlationId
        entry.acceptedAt = now
        entry.deadline = this.deadlineFor(now, receipt.expectedSettleAt)
        this.byCorrelation.set(receipt.correlationId, intentId)
        return entry
      }
    }
  }

  /**
   * Match an inbound event to the intent it settles.
   * Events without a correlation id, or with an unknown one, are external facts and settle nothing.
   */
  settleFromEvent(event: RawGameEvent): SettlementMatch {
    if (event.correlationId === undefined || event.settlement === undefined) return { kind: 'external' }
    const intentId = this.byCorrelation.get(event.correlationId)
    if (intentId === undefined) return { kind: 'external' }
    const entry = this.require(intentId)
    if (TERMINAL_STATES.has(entry.state)) return { kind: 'duplicate', entry }
    this.transition(entry, event.settlement === 'succeeded' ? 'succeeded' : 'failed')
    if (event.settlement === 'succeeded') entry.outcome = event.fields
    else entry.reason = `settled as failed by event ${event.type}`
    return { kind: 'settled', entry }
  }

  /**
   * Move every accepted intent whose deadline has passed to `overdue`.
   * @returns the intents that now need a reconciliation query.
   */
  collectOverdue(): LedgerEntry[] {
    const now = this.options.clock.now()
    const overdue: LedgerEntry[] = []
    for (const entry of this.entries.values()) {
      if (entry.state === 'accepted' && entry.deadline !== undefined && now > entry.deadline) {
        overdue.push(this.transition(entry, 'overdue'))
      }
    }
    return overdue
  }

  /** Apply the result of a reconciliation query for an overdue or in-doubt intent. */
  resolveReconciliation(intentId: string, status: CommandStatus): LedgerEntry {
    const entry = this.require(intentId)
    switch (status.kind) {
      case 'pending':
        if (entry.state !== 'overdue') return this.transition(entry, 'unknown')
        this.transition(entry, 'accepted')
        entry.deadline = this.deadlineFor(this.options.clock.now(), status.expectedSettleAt)
        return entry
      case 'succeeded':
        this.transition(entry, 'succeeded')
        entry.outcome = status.outcome
        return entry
      case 'failed':
        this.transition(entry, 'failed')
        entry.reason = status.reason
        return entry
      case 'unknown':
        return this.transition(entry, 'unknown')
    }
  }

  /** Look up one intent. */
  get(intentId: string): LedgerEntry | undefined {
    return this.entries.get(intentId)
  }

  /** Every intent that has not reached a terminal state. */
  open(): LedgerEntry[] {
    return [...this.entries.values()].filter((entry) => !TERMINAL_STATES.has(entry.state))
  }

  /** Whether an intent has reached a terminal state. */
  static isTerminal(state: IntentState): boolean {
    return TERMINAL_STATES.has(state)
  }

  private deadlineFor(now: number, expectedSettleAt: number | undefined): number {
    if (expectedSettleAt === undefined) return now + this.options.defaultSettleMs
    const expectedDuration = Math.max(0, expectedSettleAt - now)
    return expectedSettleAt + Math.max(this.options.graceMs, expectedDuration * this.options.graceRatio)
  }

  private require(intentId: string): LedgerEntry {
    const entry = this.entries.get(intentId)
    if (entry === undefined) throw new GameAgentError(`Intent ${intentId} is not recorded`, 'UNKNOWN_INTENT')
    return entry
  }

  private transition(entry: LedgerEntry, next: IntentState): LedgerEntry {
    if (!TRANSITIONS[entry.state].includes(next)) {
      throw new GameAgentError(`Intent ${entry.intent.intentId} cannot move from ${entry.state} to ${next}`, 'ILLEGAL_TRANSITION')
    }
    entry.state = next
    entry.history.push({ state: next, at: this.options.clock.now() })
    return entry
  }
}
