/**
 * Responsibilities: Run one agent as a headless game client: connect the transport, route events through ingress, tick the behavior tree, start bounded decisions, and send commands through egress.
 * Contracts: `step()` performs one cycle (poll, reconcile, observe, tick) and reports when it next needs to run; `settle()` awaits all in-flight work for deterministic simulations.
 * Constraints: Cognition (tree and model) reads only cropped observations and inbox events. Commands are never retried; in-doubt intents fail their node and stay open for review.
 */
import { ConditionRegistry, TreeRunner, type DecisionSpec, type HandleStatus, type TreeDefinition, type TreeHost } from '@game-agent/behavior-tree'
import type { JsonObject, JsonValue, Observation, TransportAdapter } from '@game-agent/contracts'
import type { DecisionEngine } from '@game-agent/decision'
import { EgressGateway, IngressGateway, QuotaLimiter, type JitterPolicy, type QuotaPolicy, type VisibilityPolicy } from '@game-agent/gateway'
import { EventInbox } from '@game-agent/inbox'
import { IntentLedger, type LedgerOptions } from '@game-agent/intent-ledger'
import type { Clock, IdSource, Rng } from '@game-agent/ports'
import type { TraceSink } from '@game-agent/trace'

/** Everything needed to run one agent. */
export interface AgentRuntimeOptions {
  readonly agentId: string
  readonly transport: TransportAdapter
  readonly tree: TreeDefinition
  readonly visibility: VisibilityPolicy
  readonly quota: QuotaPolicy
  readonly jitter: JitterPolicy
  readonly clock: Clock
  readonly rng: Rng
  readonly ids: IdSource
  readonly delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly trace: TraceSink
  /** Absent when the agent runs rules only; decision nodes then fail. */
  readonly decision?: DecisionEngine
  readonly persona?: string
  readonly conditions?: ConditionRegistry
  readonly ledger?: Omit<LedgerOptions, 'clock'>
  readonly inbox?: { readonly capacity: number; readonly dedupeWindow: number }
  /** Number of recent inbox events given to each decision. */
  readonly recentEventLimit?: number
  /** Refresh the observation (and blackboard mirror) on every step. */
  readonly observeEveryStep?: boolean
}

/** Outcome of one step. */
export interface StepResult {
  readonly status: 'success' | 'failure' | 'running'
  readonly wakeAt?: number
}

/** Snapshot of the agent for monitors and operators. */
export interface AgentStatus {
  readonly agentId: string
  readonly connected: boolean
  readonly treeId: string
  readonly treeVersion: number
  readonly lastStep?: { readonly at: number; readonly status: StepResult['status'] }
  readonly nextWakeAt?: number
  readonly openIntents: number
  readonly inbox: { readonly size: number; readonly dropped: number; readonly lastCursor: number }
  readonly decisions: number
  readonly tokens: { readonly input: number; readonly output: number; readonly cachedInput: number }
}

type HandleRecord =
  | { readonly kind: 'pending' }
  | { readonly kind: 'intent'; readonly intentId: string }
  | { readonly kind: 'done'; readonly status: Exclude<HandleStatus, { state: 'running' }> }

const DEFAULT_LEDGER = { graceMs: 30_000, graceRatio: 0.2, defaultSettleMs: 10 * 60_000 }
const DEFAULT_INBOX = { capacity: 1_000, dedupeWindow: 5_000 }

/** One agent running as a headless game client. */
export class AgentRuntime {
  readonly ledger: IntentLedger
  readonly inbox: EventInbox
  private readonly options: AgentRuntimeOptions
  private readonly ingress: IngressGateway
  private readonly egress: EgressGateway
  private readonly runner: TreeRunner
  private readonly handles = new Map<string, HandleRecord>()
  private readonly inflight = new Set<Promise<void>>()
  private readonly wakeListeners = new Set<() => void>()
  private unsubscribe: (() => void) | undefined
  private observation: Observation | undefined
  private lastStep: AgentStatus['lastStep']
  private nextWakeAt: number | undefined
  private decisionCount = 0
  private readonly tokens = { input: 0, output: 0, cachedInput: 0 }

  constructor(options: AgentRuntimeOptions) {
    this.options = options
    this.ledger = new IntentLedger({ clock: options.clock, ...(options.ledger ?? DEFAULT_LEDGER) })
    this.inbox = new EventInbox(options.inbox ?? DEFAULT_INBOX)
    this.ingress = new IngressGateway({ ledger: this.ledger, inbox: this.inbox, policy: options.visibility, trace: options.trace })
    this.egress = new EgressGateway({
      transport: options.transport,
      ledger: this.ledger,
      quota: new QuotaLimiter(options.quota, options.clock),
      clock: options.clock,
      rng: options.rng,
      ids: options.ids,
      jitter: options.jitter,
      delay: options.delay,
      trace: options.trace,
    })
    this.runner = new TreeRunner(options.tree, this.createHost(), options.conditions ?? ConditionRegistry.withBuiltins(), (leaf) => {
      options.trace.write({
        at: options.clock.now(),
        agentId: options.agentId,
        category: 'tick',
        name: `node.${leaf.status}`,
        tags: [],
        detail: { path: leaf.path, type: leaf.node.type, ...(leaf.node.name === undefined ? {} : { name: leaf.node.name }), ...(leaf.reason === undefined ? {} : { reason: leaf.reason }) },
      })
    })
  }

  /** Blackboard shared by the tree; visible observation fields are mirrored as `<view>.<field>`. */
  get blackboard(): Map<string, JsonValue> {
    return this.runner.blackboard
  }

  /** Connect, load the action catalog, subscribe to events, and take the first observation. */
  async start(signal?: AbortSignal): Promise<void> {
    const { transport } = this.options
    await transport.connect(signal)
    this.egress.setCatalog(await transport.listActions(signal))
    this.unsubscribe = transport.subscribe((raw) => {
      if (raw.agentId !== this.options.agentId) return
      if (this.ingress.accept(raw).kind === 'stored') this.requestWake()
    })
    await this.refreshObservation(signal)
  }

  /** Run one cycle: poll, reconcile overdue intents, observe, and tick the tree. */
  async step(signal?: AbortSignal): Promise<StepResult> {
    await this.options.transport.poll?.(signal)
    await this.reconcileOverdue(signal)
    if (this.options.observeEveryStep ?? true) await this.refreshObservation(signal)
    const result = this.runner.tick()
    const now = this.options.clock.now()
    this.lastStep = { at: now, status: result.status }
    this.nextWakeAt = result.wakeAt
    return { status: result.status, ...(result.wakeAt === undefined ? {} : { wakeAt: result.wakeAt }) }
  }

  /** Await every in-flight command and decision started so far. */
  async settle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight])
  }

  /** Register a callback fired when new events or finished work make another step useful. */
  onWake(listener: () => void): () => void {
    this.wakeListeners.add(listener)
    return () => {
      this.wakeListeners.delete(listener)
    }
  }

  /** Swap in an edited tree without restarting the agent. */
  replaceTree(tree: TreeDefinition): void {
    this.runner.replaceTree(tree)
  }

  /** Disconnect from the game. */
  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.settle()
    await this.options.transport.close()
  }

  /** Current status for monitors. */
  status(): AgentStatus {
    const definition = this.runner.definition
    return {
      agentId: this.options.agentId,
      connected: this.unsubscribe !== undefined,
      treeId: definition.id,
      treeVersion: definition.version,
      ...(this.lastStep === undefined ? {} : { lastStep: this.lastStep }),
      ...(this.nextWakeAt === undefined ? {} : { nextWakeAt: this.nextWakeAt }),
      openIntents: this.ledger.open().length,
      inbox: { size: this.inbox.size, dropped: this.inbox.dropped, lastCursor: this.inbox.lastCursor },
      decisions: this.decisionCount,
      tokens: { ...this.tokens },
    }
  }

  private createHost(): TreeHost {
    return {
      now: () => this.options.clock.now(),
      startAction: (action, args) => this.startAction(action, args),
      startDecision: (spec) => this.startDecision(spec),
      handleStatus: (handle) => this.handleStatus(handle),
      currentCursor: () => this.inbox.lastCursor,
      countEventsAfter: (cursor, eventType) => this.inbox.readAfter(cursor).filter((entry) => entry.event.type === eventType).length,
    }
  }

  private startAction(action: string, args: JsonObject): string {
    const handle = this.options.ids.next('handle')
    this.handles.set(handle, { kind: 'pending' })
    this.track(
      this.egress.dispatch({ agentId: this.options.agentId, action, args, source: 'tree' }).then((outcome) => {
        if (outcome.kind === 'dispatched') this.handles.set(handle, { kind: 'intent', intentId: outcome.entry.intent.intentId })
        else if (outcome.kind === 'in-doubt') this.finish(handle, { state: 'failed', reason: 'command outcome is in doubt; not retried' })
        else this.finish(handle, { state: 'failed', reason: `${outcome.code}: ${outcome.detail}` })
      }),
    )
    return handle
  }

  private startDecision(spec: DecisionSpec): string {
    const handle = this.options.ids.next('handle')
    this.handles.set(handle, { kind: 'pending' })
    this.track(this.runDecision(handle, spec))
    return handle
  }

  private async runDecision(handle: string, spec: DecisionSpec): Promise<void> {
    const engine = this.options.decision
    if (engine === undefined) {
      this.finish(handle, { state: 'failed', reason: 'no model is configured for decision nodes' })
      return
    }
    await this.refreshObservation()
    const allowed = new Set(spec.tools)
    const limit = this.options.recentEventLimit ?? 20
    const recent = this.inbox.readAfter(Math.max(0, this.inbox.lastCursor - limit)).map((entry) => entry.event)
    const observation = this.observation ?? { agentId: this.options.agentId, takenAt: this.options.clock.now(), views: {} }
    const result = await engine.decide({
      agentId: this.options.agentId,
      purpose: spec.purpose,
      ...(this.options.persona === undefined ? {} : { persona: this.options.persona }),
      observation,
      recentEvents: recent,
      tools: this.egress.actions().filter((action) => allowed.has(action.name)),
      maxProposals: spec.maxProposals,
      timeoutMs: spec.timeoutMs,
    })
    this.decisionCount += 1
    if (result.kind !== 'failed' && result.usage !== undefined) {
      this.tokens.input += result.usage.inputTokens
      this.tokens.output += result.usage.outputTokens
      this.tokens.cachedInput += result.usage.cachedInputTokens
    }
    this.options.trace.write({
      at: this.options.clock.now(),
      agentId: this.options.agentId,
      category: 'decision',
      name: `decision.${result.kind}`,
      tags: [],
      detail: {
        purpose: spec.purpose,
        ...(result.kind === 'failed' ? { reason: result.reason } : { rationale: result.rationale, rejected: result.rejected.map((item) => `${item.action}: ${item.reason}`) }),
        ...(result.kind === 'proposed' ? { proposals: result.proposals.map((item) => item.action) } : {}),
        ...(result.kind !== 'failed' && result.usage !== undefined ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cachedInputTokens: result.usage.cachedInputTokens } : {}),
      },
    })
    if (result.kind === 'failed') {
      this.finish(handle, { state: 'failed', reason: result.reason })
      return
    }
    if (result.kind === 'abstained') {
      this.finish(handle, { state: 'failed', reason: `abstained: ${result.rationale}` })
      return
    }
    let dispatched = 0
    for (const proposal of result.proposals) {
      const outcome = await this.egress.dispatch({ agentId: this.options.agentId, action: proposal.action, args: proposal.args, source: 'decision' })
      if (outcome.kind === 'dispatched') dispatched += 1
    }
    this.finish(
      handle,
      dispatched > 0
        ? { state: 'succeeded', output: { rationale: result.rationale, dispatched, proposals: result.proposals.map((item) => item.action) } }
        : { state: 'failed', reason: 'every proposal was refused by the gateway' },
    )
  }

  private handleStatus(handle: string): HandleStatus {
    const record = this.handles.get(handle)
    if (record === undefined) return { state: 'failed', reason: `unknown handle ${handle}` }
    if (record.kind === 'pending') return { state: 'running' }
    if (record.kind === 'done') {
      this.handles.delete(handle)
      return record.status
    }
    const entry = this.ledger.get(record.intentId)
    if (entry === undefined) return { state: 'failed', reason: `intent ${record.intentId} is missing` }
    switch (entry.state) {
      case 'succeeded':
        this.handles.delete(handle)
        return { state: 'succeeded', ...(entry.outcome === undefined ? {} : { output: entry.outcome }) }
      case 'failed':
      case 'rejected':
      case 'unknown':
      case 'in-doubt':
        this.handles.delete(handle)
        return { state: 'failed', reason: `${entry.state}${entry.reason === undefined ? '' : `: ${entry.reason}`}` }
      default:
        return { state: 'running' }
    }
  }

  private async reconcileOverdue(signal?: AbortSignal): Promise<void> {
    for (const entry of this.ledger.collectOverdue()) {
      const query = this.options.transport.queryCommand
      const status = query === undefined || entry.correlationId === undefined ? undefined : await query.call(this.options.transport, entry.correlationId, signal)
      if (status !== undefined) this.ledger.resolveReconciliation(entry.intent.intentId, status)
      this.options.trace.write({
        at: this.options.clock.now(),
        agentId: this.options.agentId,
        category: 'intent',
        name: 'intent.reconciled',
        tags: [],
        detail: { intentId: entry.intent.intentId, state: entry.state, queried: status !== undefined },
      })
    }
  }

  private async refreshObservation(signal?: AbortSignal): Promise<void> {
    const snapshot = await this.options.transport.snapshot(this.options.agentId, signal)
    this.observation = this.ingress.observe(snapshot)
    for (const [viewName, fields] of Object.entries(this.observation.views)) {
      for (const [field, value] of Object.entries(fields)) this.runner.blackboard.set(`${viewName}.${field}`, value)
    }
  }

  private finish(handle: string, status: Exclude<HandleStatus, { state: 'running' }>): void {
    this.handles.set(handle, { kind: 'done', status })
    this.requestWake()
  }

  private track(work: Promise<void>): void {
    const tracked = work
      .catch((error: unknown) => {
        this.options.trace.write({
          at: this.options.clock.now(),
          agentId: this.options.agentId,
          category: 'fault',
          name: 'runtime.unhandled',
          tags: [],
          detail: { message: error instanceof Error ? error.message : String(error) },
        })
      })
      .finally(() => {
        this.inflight.delete(tracked)
        this.requestWake()
      })
    this.inflight.add(tracked)
  }

  private requestWake(): void {
    for (const listener of this.wakeListeners) listener()
  }
}
