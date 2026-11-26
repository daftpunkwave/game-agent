/**
 * Responsibilities: Implement the `TransportAdapter` port on top of an MCP session, for games and game-server bridges that expose MCP tools.
 * Contracts: Every listed tool except the reserved snapshot, events, and status tools becomes an action. Receipts follow the structured-content convention
 *   `{ receipt: 'accepted' | 'rejected' | 'completed', correlationId?, expectedSettleAt?, reason?, outcome? }`; without it, success text is a completed outcome.
 * Constraints: MCP is one access protocol among several. Event delivery is optional and pull-based through `eventsTool`; the adapter never resends commands.
 */
import type {
  ActionSpec,
  CommandReceipt,
  CommandStatus,
  GameIntent,
  JsonObject,
  JsonValue,
  RawGameEvent,
  RawSnapshot,
  TransportAdapter,
  TransportCapabilities,
} from '@game-agent/contracts'
import { isJsonObject } from '@game-agent/contracts'
import { GameAgentError } from '@game-agent/errors'
import { systemClock, type Clock } from '@game-agent/ports'
import { connectMcpSession, type McpConnection, type McpSession, type McpSessionFactory } from './session.ts'

/** Configuration of one MCP-backed game connection. */
export interface McpTransportConfig {
  readonly connection: McpConnection
  /** Agent controlled through this connection. */
  readonly agentId: string
  /** Tool returning the visible state as `{ <view>: { ... } }`. */
  readonly snapshotTool: string
  /** Optional tool returning `{ events: RawGameEvent-like[], cursor }` for `{ cursor }`. */
  readonly eventsTool?: string
  /** Optional tool returning a command status for `{ correlationId }`. */
  readonly statusTool?: string
  /** Tools that spend resources; duplicates of these must never be retried blindly. */
  readonly resourceConsumingTools?: readonly string[]
  readonly callTimeoutMs: number
  /** Whether the game pauses its clock while the agent thinks (true for some local mods). */
  readonly canPauseGameTime?: boolean
  /** Time source for snapshot and fallback event timestamps. */
  readonly clock?: Clock
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Transport adapter speaking MCP. */
export class McpTransportAdapter implements TransportAdapter {
  readonly name = 'mcp'
  readonly capabilities: TransportCapabilities
  private readonly config: McpTransportConfig
  private readonly openSession: McpSessionFactory
  private session: McpSession | undefined
  private readonly listeners = new Set<(event: RawGameEvent) => void>()
  private eventCursor: JsonValue = null

  constructor(config: McpTransportConfig, connect: McpSessionFactory = connectMcpSession) {
    this.config = config
    this.openSession = connect
    this.capabilities = {
      honorsIdempotencyKey: false,
      deliversEvents: config.eventsTool !== undefined,
      canPauseGameTime: config.canPauseGameTime ?? false,
    }
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.session ??= await this.openSession(this.config.connection, signal)
  }

  async close(): Promise<void> {
    this.listeners.clear()
    await this.session?.close()
    this.session = undefined
  }

  async listActions(signal?: AbortSignal): Promise<readonly ActionSpec[]> {
    const reserved = new Set([this.config.snapshotTool, this.config.eventsTool, this.config.statusTool].filter((name) => name !== undefined))
    const consuming = new Set(this.config.resourceConsumingTools ?? [])
    const tools = await this.require().listTools(signal)
    return tools
      .filter((tool) => !reserved.has(tool.name))
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema, consumesResources: consuming.has(tool.name) }))
  }

  async send(intent: GameIntent, signal?: AbortSignal): Promise<CommandReceipt> {
    const result = await this.require().callTool(intent.action, intent.args, this.config.callTimeoutMs, signal)
    const structured = result.structured as JsonValue | undefined
    if (isJsonObject(structured) && typeof structured['receipt'] === 'string') {
      const kind = structured['receipt']
      if (kind === 'accepted') {
        const correlationId = asString(structured['correlationId'])
        if (correlationId === undefined) throw new GameAgentError(`Tool ${intent.action} accepted without a correlationId`, 'MCP_RECEIPT_INVALID')
        const expectedSettleAt = asNumber(structured['expectedSettleAt'])
        return { kind: 'accepted', correlationId, ...(expectedSettleAt === undefined ? {} : { expectedSettleAt }) }
      }
      if (kind === 'rejected') return { kind: 'rejected', reason: asString(structured['reason']) ?? result.text }
      return { kind: 'completed', outcome: structured['outcome'] ?? null }
    }
    if (result.isError) return { kind: 'rejected', reason: result.text || 'tool reported an error' }
    return { kind: 'completed', outcome: structured ?? result.text }
  }

  async snapshot(agentId: string, signal?: AbortSignal): Promise<RawSnapshot> {
    const result = await this.require().callTool(this.config.snapshotTool, {}, this.config.callTimeoutMs, signal)
    if (result.isError) throw new GameAgentError(`Snapshot tool failed: ${result.text}`, 'MCP_SNAPSHOT_FAILED')
    const structured = result.structured as JsonValue | undefined
    const views: Record<string, JsonObject> = {}
    if (isJsonObject(structured)) {
      for (const [name, view] of Object.entries(structured)) if (isJsonObject(view)) views[name] = view
    } else {
      views['text'] = { content: result.text }
    }
    return { agentId, takenAt: (this.config.clock ?? systemClock).now(), views }
  }

  subscribe(listener: (event: RawGameEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async queryCommand(correlationId: string, signal?: AbortSignal): Promise<CommandStatus> {
    if (this.config.statusTool === undefined) return { kind: 'unknown' }
    const result = await this.require().callTool(this.config.statusTool, { correlationId }, this.config.callTimeoutMs, signal)
    const structured = result.structured as JsonValue | undefined
    if (result.isError || !isJsonObject(structured)) return { kind: 'unknown' }
    switch (structured['status']) {
      case 'pending': {
        const expectedSettleAt = asNumber(structured['expectedSettleAt'])
        return { kind: 'pending', ...(expectedSettleAt === undefined ? {} : { expectedSettleAt }) }
      }
      case 'succeeded':
        return { kind: 'succeeded', outcome: structured['outcome'] ?? null }
      case 'failed':
        return { kind: 'failed', reason: asString(structured['reason']) ?? 'failed' }
      default:
        return { kind: 'unknown' }
    }
  }

  async poll(signal?: AbortSignal): Promise<void> {
    if (this.config.eventsTool === undefined || this.listeners.size === 0) return
    const result = await this.require().callTool(this.config.eventsTool, { cursor: this.eventCursor }, this.config.callTimeoutMs, signal)
    const structured = result.structured as JsonValue | undefined
    if (result.isError || !isJsonObject(structured)) return
    const events = Array.isArray(structured['events']) ? structured['events'] : []
    for (const item of events) {
      const event = this.toRawEvent(item)
      if (event !== undefined) for (const listener of this.listeners) listener(event)
    }
    if ('cursor' in structured) this.eventCursor = structured['cursor'] ?? null
  }

  private toRawEvent(item: JsonValue): RawGameEvent | undefined {
    if (!isJsonObject(item)) return undefined
    const eventId = asString(item['eventId'])
    const type = asString(item['type'])
    if (eventId === undefined || type === undefined) return undefined
    const correlationId = asString(item['correlationId'])
    const settlement = item['settlement'] === 'succeeded' || item['settlement'] === 'failed' ? item['settlement'] : undefined
    return {
      eventId,
      agentId: this.config.agentId,
      type,
      occurredAt: asNumber(item['occurredAt']) ?? (this.config.clock ?? systemClock).now(),
      fields: isJsonObject(item['fields']) ? item['fields'] : {},
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(settlement === undefined ? {} : { settlement }),
    }
  }

  private require(): McpSession {
    if (this.session === undefined) throw new GameAgentError('MCP transport is not connected', 'MCP_NOT_CONNECTED')
    return this.session
  }
}
