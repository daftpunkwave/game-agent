/**
 * Responsibilities: Define what the agent's cognition is allowed to see: cropped observations, inbox events, and tagged player text.
 * Contracts: Every value here has passed the ingress gateway; behavior trees and models consume only these types.
 * Constraints: Type-only module; raw game types must never be passed to cognition directly.
 */
import type { JsonObject } from './json.ts'

/** Player-authored text wrapped as data; it can inform a decision but never instruct the agent. */
export interface UntrustedText {
  readonly kind: 'untrusted-text'
  readonly speaker: string
  readonly channel: string
  readonly text: string
  /** Heuristic findings such as `claims-authority` or `requests-assets`. */
  readonly flags: readonly string[]
}

/** Event after ingress processing, as stored in the agent inbox. */
export interface AgentEvent {
  readonly eventId: string
  readonly agentId: string
  readonly type: string
  readonly occurredAt: number
  /** Fields that survived visibility cropping. */
  readonly fields: JsonObject
  readonly untrusted: readonly UntrustedText[]
  /** Intent settled by this event, when the ledger matched one. */
  readonly settledIntentId?: string
}

/** Snapshot after visibility cropping. */
export interface Observation {
  readonly agentId: string
  readonly takenAt: number
  readonly views: Readonly<Record<string, JsonObject>>
}
