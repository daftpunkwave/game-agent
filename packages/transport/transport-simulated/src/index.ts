/**
 * Responsibilities: Provide a small simulated game behind the `TransportAdapter` port for tests, demos, and accelerated rule-layer simulation.
 * Contracts: `gather` and `say` complete immediately; `upgrade_farm` is accepted and settles later through a pushed event; snapshots include a hidden `intel` view that visibility policies must remove.
 * Constraints: Time comes only from the injected Clock; `advance()` must be called after moving the clock to release due events. Not a model of any real game.
 */
import type {
  ActionSpec,
  CommandReceipt,
  CommandStatus,
  GameIntent,
  RawGameEvent,
  RawSnapshot,
  TransportAdapter,
} from '@game-agent/contracts'
import type { Clock } from '@game-agent/ports'

/** Settings of the simulation. */
export interface SimulatedGameOptions {
  readonly clock: Clock
  readonly agents: readonly string[]
  /** Duration of one farm upgrade. */
  readonly upgradeDurationMs: number
}

interface AgentState {
  food: number
  wood: number
  farmLevel: number
  upgrade?: { correlationId: string; completeAt: number }
  hiddenThreat: number
}

/** Actions offered by the simulation. */
export const SIMULATED_ACTIONS: readonly ActionSpec[] = [
  {
    name: 'gather',
    description: 'Gather 25 units of food or wood. Completes immediately.',
    parameters: { type: 'object', properties: { resource: { type: 'string', enum: ['food', 'wood'] } }, required: ['resource'], additionalProperties: false },
    consumesResources: false,
    tags: ['resource-gain'],
  },
  {
    name: 'upgrade_farm',
    description: 'Spend 50 wood per current level to upgrade the farm. Finishes later.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    consumesResources: true,
    tags: ['spending'],
  },
  {
    name: 'say',
    description: 'Post a message to a chat channel.',
    parameters: {
      type: 'object',
      properties: { channel: { type: 'string', enum: ['world', 'alliance'] }, text: { type: 'string' } },
      required: ['channel', 'text'],
      additionalProperties: false,
    },
    consumesResources: false,
    tags: ['social'],
  },
]

/** In-process simulated game. */
export class SimulatedGameTransport implements TransportAdapter {
  readonly name = 'simulated'
  readonly capabilities = { honorsIdempotencyKey: true, deliversEvents: true, canPauseGameTime: true }
  private readonly options: SimulatedGameOptions
  private readonly agents = new Map<string, AgentState>()
  private readonly listeners = new Set<(event: RawGameEvent) => void>()
  private readonly receipts = new Map<string, CommandReceipt>()
  private readonly settled = new Map<string, CommandStatus>()
  private sequence = 0

  constructor(options: SimulatedGameOptions) {
    this.options = options
    for (const agentId of options.agents) this.agents.set(agentId, { food: 50, wood: 60, farmLevel: 1, hiddenThreat: 7 })
  }

  async connect(): Promise<void> {}

  async close(): Promise<void> {
    this.listeners.clear()
  }

  async listActions(): Promise<readonly ActionSpec[]> {
    return SIMULATED_ACTIONS
  }

  async send(intent: GameIntent): Promise<CommandReceipt> {
    const previous = this.receipts.get(intent.idempotencyKey)
    if (previous !== undefined) return previous
    const receipt = this.execute(intent)
    this.receipts.set(intent.idempotencyKey, receipt)
    return receipt
  }

  async snapshot(agentId: string): Promise<RawSnapshot> {
    const state = this.require(agentId)
    return {
      agentId,
      takenAt: this.options.clock.now(),
      views: {
        city: { food: state.food, wood: state.wood, farmLevel: state.farmLevel, upgradeCost: 50 * state.farmLevel, upgrading: state.upgrade !== undefined },
        intel: { hiddenThreat: state.hiddenThreat },
      },
    }
  }

  subscribe(listener: (event: RawGameEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async queryCommand(correlationId: string): Promise<CommandStatus> {
    const settled = this.settled.get(correlationId)
    if (settled !== undefined) return settled
    for (const state of this.agents.values()) {
      if (state.upgrade?.correlationId === correlationId) return { kind: 'pending', expectedSettleAt: state.upgrade.completeAt }
    }
    return { kind: 'unknown' }
  }

  /** Release every event that is due at the current clock time. */
  advance(): void {
    const now = this.options.clock.now()
    for (const [agentId, state] of this.agents) {
      if (state.upgrade === undefined || state.upgrade.completeAt > now) continue
      const { correlationId, completeAt } = state.upgrade
      delete state.upgrade
      state.farmLevel += 1
      this.settled.set(correlationId, { kind: 'succeeded', outcome: { farmLevel: state.farmLevel } })
      this.emit({
        eventId: this.nextId('evt'),
        agentId,
        type: 'farm.upgraded',
        occurredAt: completeAt,
        correlationId,
        settlement: 'succeeded',
        fields: { farmLevel: state.farmLevel },
      })
    }
  }

  /** Deliver an arbitrary event, e.g. a scripted player whisper in a scenario. */
  inject(event: RawGameEvent): void {
    this.emit(event)
  }

  private execute(intent: GameIntent): CommandReceipt {
    const state = this.require(intent.agentId)
    switch (intent.action) {
      case 'gather': {
        const resource = intent.args['resource'] === 'wood' ? 'wood' : 'food'
        state[resource] += 25
        return { kind: 'completed', outcome: { resource, gained: 25 } }
      }
      case 'upgrade_farm': {
        const cost = 50 * state.farmLevel
        if (state.upgrade !== undefined) return { kind: 'rejected', reason: 'an upgrade is already in progress' }
        if (state.wood < cost) return { kind: 'rejected', reason: `needs ${cost} wood` }
        state.wood -= cost
        const correlationId = this.nextId('upg')
        const completeAt = this.options.clock.now() + this.options.upgradeDurationMs
        state.upgrade = { correlationId, completeAt }
        return { kind: 'accepted', correlationId, expectedSettleAt: completeAt }
      }
      case 'say':
        return { kind: 'completed', outcome: { delivered: true } }
      default:
        return { kind: 'rejected', reason: `unknown action ${intent.action}` }
    }
  }

  private emit(event: RawGameEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private require(agentId: string): AgentState {
    const state = this.agents.get(agentId)
    if (state === undefined) throw new Error(`agent ${agentId} is not part of the simulation`)
    return state
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}
