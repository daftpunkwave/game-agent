/**
 * Responsibilities: Single entry for everything the game reports: settle intents, crop to player-visible data, tag player text, store in the inbox.
 * Contracts: Stage order is fixed (settle, crop, tag, store); settlement sees raw correlation ids, cognition sees only cropped data.
 * Constraints: Behavior trees and models must never receive raw events or snapshots; they read the inbox and `observe()` output only.
 */
import type { AgentEvent, Observation, RawGameEvent, RawSnapshot } from '@game-agent/contracts'
import type { EventInbox, InboxEntry } from '@game-agent/inbox'
import type { IntentLedger, SettlementMatch } from '@game-agent/intent-ledger'
import type { TraceSink } from '@game-agent/trace'
import { DEFAULT_SCREEN_RULES, tagPlayerText, type TextScreenRule } from './untrusted-text.ts'
import { cropFields, type VisibilityPolicy } from './visibility.ts'

/** Collaborators of the ingress gateway. */
export interface IngressDependencies {
  readonly ledger: IntentLedger
  readonly inbox: EventInbox
  readonly policy: VisibilityPolicy
  readonly trace: TraceSink
  readonly screenRules?: readonly TextScreenRule[]
  readonly maxPlayerTextLength?: number
}

/** Result of accepting one raw event. */
export type IngressOutcome =
  | { readonly kind: 'stored'; readonly entry: InboxEntry; readonly settlement: SettlementMatch }
  | { readonly kind: 'duplicate'; readonly settlement: SettlementMatch }

const DEFAULT_MAX_PLAYER_TEXT = 500

/** Inbound gateway for one agent or shard. */
export class IngressGateway {
  private readonly deps: IngressDependencies

  constructor(deps: IngressDependencies) {
    this.deps = deps
  }

  /** Process one raw event through every stage. */
  accept(raw: RawGameEvent): IngressOutcome {
    const settlement = this.deps.ledger.settleFromEvent(raw)
    const rule = this.deps.policy.events[raw.type]
    const { fields, audit } = cropFields(raw.fields, rule, this.deps.policy.budget)
    const untrusted = (raw.playerText ?? []).map((text) =>
      tagPlayerText(text, this.deps.screenRules ?? DEFAULT_SCREEN_RULES, this.deps.maxPlayerTextLength ?? DEFAULT_MAX_PLAYER_TEXT),
    )
    const event: AgentEvent = {
      eventId: raw.eventId,
      agentId: raw.agentId,
      type: raw.type,
      occurredAt: raw.occurredAt,
      fields,
      untrusted,
      ...(settlement.kind === 'settled' ? { settledIntentId: settlement.entry.intent.intentId } : {}),
    }
    const entry = this.deps.inbox.append(event)
    this.deps.trace.write({
      at: raw.occurredAt,
      agentId: raw.agentId,
      category: settlement.kind === 'settled' ? 'settlement' : 'ingress',
      name: raw.type,
      tags: rule?.tags ?? [],
      detail: {
        settlement: settlement.kind,
        removedFields: audit.removed,
        coarsenedFields: audit.coarsened,
        flaggedTexts: untrusted.filter((text) => text.flags.length > 0).length,
        stored: entry !== undefined,
      },
    })
    return entry === undefined ? { kind: 'duplicate', settlement } : { kind: 'stored', entry, settlement }
  }

  /** Crop a raw snapshot into the observation cognition may read. */
  observe(snapshot: RawSnapshot): Observation {
    const views: Record<string, Observation['views'][string]> = {}
    for (const [name, raw] of Object.entries(snapshot.views)) {
      const rule = this.deps.policy.views[name]
      if (rule === undefined) continue
      views[name] = cropFields(raw, rule, this.deps.policy.budget).fields
    }
    return { agentId: snapshot.agentId, takenAt: snapshot.takenAt, views }
  }
}
