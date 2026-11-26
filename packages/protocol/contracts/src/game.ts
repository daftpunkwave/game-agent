/**
 * Responsibilities: Define the vocabulary exchanged between a game and the agent runtime: intents, receipts, events, snapshots, and the transport port.
 * Contracts: A receipt is never a result; `accepted` commands settle later through events that carry the same correlation id.
 * Constraints: Type-only module; transports implement `TransportAdapter` and must not leak transport-specific types through it.
 */
import type { JsonObject, JsonObjectSchema, JsonValue } from './json.ts'

/** Producer of an intent; used for attribution in traces and audits. */
export type IntentSource = 'tree' | 'decision' | 'operator'

/** A command the agent wants the game to perform. */
export interface GameIntent {
  readonly intentId: string
  readonly agentId: string
  readonly action: string
  readonly args: JsonObject
  readonly source: IntentSource
  readonly issuedAt: number
  /** Deterministic key; only useful when the transport declares `honorsIdempotencyKey`. */
  readonly idempotencyKey: string
}

/** Immediate answer of the game to a command. */
export type CommandReceipt =
  | { readonly kind: 'completed'; readonly outcome: JsonValue }
  | { readonly kind: 'accepted'; readonly correlationId: string; readonly expectedSettleAt?: number }
  | { readonly kind: 'rejected'; readonly reason: string }

/** Result of querying a previously accepted command during reconciliation. */
export type CommandStatus =
  | { readonly kind: 'pending'; readonly expectedSettleAt?: number }
  | { readonly kind: 'succeeded'; readonly outcome: JsonValue }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'unknown' }

/** Free text written by another player, such as chat or mail. */
export interface PlayerText {
  readonly speaker: string
  readonly channel: string
  readonly text: string
}

/** Event exactly as the game reported it, before visibility cropping. */
export interface RawGameEvent {
  readonly eventId: string
  readonly agentId: string
  readonly type: string
  readonly occurredAt: number
  /** Server-issued id that links this event to an accepted command. */
  readonly correlationId?: string
  /** Present when the event settles a command. */
  readonly settlement?: 'succeeded' | 'failed'
  readonly fields: JsonObject
  readonly playerText?: readonly PlayerText[]
}

/** Snapshot of the game state for one agent, keyed by in-game view (screen or panel). */
export interface RawSnapshot {
  readonly agentId: string
  readonly takenAt: number
  readonly views: Readonly<Record<string, JsonObject>>
}

/** One action the game exposes to agents. */
export interface ActionSpec {
  readonly name: string
  readonly description: string
  readonly parameters: JsonObjectSchema
  /** Whether a duplicate execution would spend in-game resources. */
  readonly consumesResources: boolean
  /** Monitoring labels such as `spending` or `combat`. */
  readonly tags?: readonly string[]
}

/** What a transport can guarantee; the runtime adapts its policies to these flags. */
export interface TransportCapabilities {
  /** The server deduplicates commands carrying the same idempotency key. */
  readonly honorsIdempotencyKey: boolean
  /** The transport delivers server-initiated events. */
  readonly deliversEvents: boolean
  /** The game clock can pause while the agent is deciding (typical for local mods, impossible online). */
  readonly canPauseGameTime: boolean
}

/** Port implemented by every game connection (MCP, WebSocket, in-memory simulation, ...). */
export interface TransportAdapter {
  readonly name: string
  readonly capabilities: TransportCapabilities
  connect(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
  listActions(signal?: AbortSignal): Promise<readonly ActionSpec[]>
  send(intent: GameIntent, signal?: AbortSignal): Promise<CommandReceipt>
  snapshot(agentId: string, signal?: AbortSignal): Promise<RawSnapshot>
  /**
   * Register a listener for server-initiated events.
   * @returns a function that removes the listener.
   */
  subscribe(listener: (event: RawGameEvent) => void): () => void
  /** Query an accepted command by correlation id; absent when the game offers no such query. */
  queryCommand?(correlationId: string, signal?: AbortSignal): Promise<CommandStatus>
  /** Pull pending events for transports without server push; the runtime calls it once per step. */
  poll?(signal?: AbortSignal): Promise<void>
}
