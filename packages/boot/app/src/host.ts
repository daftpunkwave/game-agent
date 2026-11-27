/**
 * Responsibilities: Provide the `gameAgents` kernel service that starts, schedules, lists, and stops agent runtimes inside one process (one shard).
 * Contracts: Each agent gets its own scheduler; faults are traced per agent; unloading the plugin stops every agent it started.
 * Constraints: Composition only; transports, models, and policies are supplied by the caller in `AgentRuntimeOptions`.
 */
import { Context, Service } from '@game-agent/kernel'
import { AgentRuntime, type AgentRuntimeOptions, type AgentStatus } from '@game-agent/agent-runtime'
import type { Clock } from '@game-agent/ports'
import { AgentScheduler, type TimerPort } from './scheduler.ts'

declare module '@game-agent/kernel' {
  interface Context {
    gameAgents: GameAgentHost
  }
}

/** Configuration of the host service. */
export interface GameAgentHostConfig {
  readonly clock: Clock
  readonly timers?: TimerPort
  readonly heartbeatMs?: number
  readonly initialBackoffMs?: number
  readonly maxBackoffMs?: number
}

interface HostedAgent {
  readonly runtime: AgentRuntime
  readonly scheduler: AgentScheduler
}

const nodeTimers: TimerPort = {
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Hosts many agent runtimes in one process. */
export class GameAgentHost extends Service {
  private readonly config: GameAgentHostConfig
  private readonly agents = new Map<string, HostedAgent>()

  constructor(ctx: Context, config: GameAgentHostConfig) {
    super(ctx, 'gameAgents')
    this.config = config
    ctx.effect(() => () => {
      void this.stopAll()
    })
  }

  /**
   * Start an agent and begin scheduling it.
   * @throws Error when an agent with the same id is already hosted.
   */
  async spawn(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    if (this.agents.has(options.agentId)) throw new Error(`Agent ${options.agentId} is already running`)
    const runtime = new AgentRuntime(options)
    await runtime.start()
    const scheduler = new AgentScheduler(runtime, {
      clock: this.config.clock,
      timers: this.config.timers ?? nodeTimers,
      heartbeatMs: this.config.heartbeatMs ?? 60_000,
      initialBackoffMs: this.config.initialBackoffMs ?? 1_000,
      maxBackoffMs: this.config.maxBackoffMs ?? 5 * 60_000,
      onFault: (error, failures) => {
        options.trace.write({
          at: this.config.clock.now(),
          agentId: options.agentId,
          category: 'fault',
          name: 'step.failed',
          tags: [],
          detail: { message: error instanceof Error ? error.message : String(error), consecutiveFailures: failures },
        })
      },
    })
    this.agents.set(options.agentId, { runtime, scheduler })
    scheduler.start()
    return runtime
  }

  /** Status of every hosted agent. */
  list(): AgentStatus[] {
    return [...this.agents.values()].map((agent) => agent.runtime.status())
  }

  /** Runtime of one agent. */
  get(agentId: string): AgentRuntime | undefined {
    return this.agents.get(agentId)?.runtime
  }

  /** Stop scheduling and disconnect one agent. */
  async stop(agentId: string): Promise<void> {
    const hosted = this.agents.get(agentId)
    if (hosted === undefined) return
    this.agents.delete(agentId)
    hosted.scheduler.stop()
    await hosted.runtime.stop()
  }

  /** Stop every hosted agent. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.agents.keys()].map((agentId) => this.stop(agentId)))
  }
}
