/**
 * Responsibilities: Decide when one agent steps: immediately on wake-ups, at the tree's next wake time, or at a heartbeat; never two steps at once.
 * Contracts: A failing step is reported and retried with exponential backoff, so one faulty agent cannot starve or crash the others in its process.
 * Constraints: Timers and time are injected; the scheduler holds no game or model state.
 */
import type { Clock } from '@game-agent/ports'

/** Timer functions; production uses `setTimeout`/`clearTimeout`. */
export interface TimerPort {
  set(callback: () => void, milliseconds: number): unknown
  clear(handle: unknown): void
}

/** What the scheduler drives. */
export interface SchedulableAgent {
  step(): Promise<{ readonly wakeAt?: number }>
  onWake(listener: () => void): () => void
}

/** Pacing policy. */
export interface SchedulerOptions {
  readonly clock: Clock
  readonly timers: TimerPort
  /** Longest interval between steps when nothing else wakes the agent. */
  readonly heartbeatMs: number
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
  readonly onFault: (error: unknown, consecutiveFailures: number) => void
}

/** Single-flight step scheduler for one agent. */
export class AgentScheduler {
  private readonly agent: SchedulableAgent
  private readonly options: SchedulerOptions
  private timer: unknown
  private running = false
  private rerun = false
  private stopped = true
  private failures = 0
  private detach: (() => void) | undefined

  constructor(agent: SchedulableAgent, options: SchedulerOptions) {
    this.agent = agent
    this.options = options
  }

  /** Number of consecutive failed steps. */
  get consecutiveFailures(): number {
    return this.failures
  }

  /** Begin stepping. */
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.detach = this.agent.onWake(() => this.wake())
    this.schedule(0)
  }

  /** Stop stepping; an in-flight step finishes but nothing new starts. */
  stop(): void {
    this.stopped = true
    this.detach?.()
    this.detach = undefined
    if (this.timer !== undefined) this.options.timers.clear(this.timer)
    this.timer = undefined
  }

  /** Request a step as soon as possible. */
  wake(): void {
    if (this.stopped) return
    if (this.running) {
      this.rerun = true
      return
    }
    this.schedule(0)
  }

  private schedule(delay: number): void {
    if (this.stopped) return
    if (this.timer !== undefined) this.options.timers.clear(this.timer)
    this.timer = this.options.timers.set(() => {
      this.timer = undefined
      void this.run()
    }, Math.max(0, delay))
  }

  private async run(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    let next = this.options.heartbeatMs
    try {
      const result = await this.agent.step()
      this.failures = 0
      if (result.wakeAt !== undefined) next = Math.min(next, result.wakeAt - this.options.clock.now())
    } catch (error) {
      this.failures += 1
      this.options.onFault(error, this.failures)
      next = Math.min(this.options.maxBackoffMs, this.options.initialBackoffMs * 2 ** (this.failures - 1))
    } finally {
      this.running = false
    }
    if (this.rerun && this.failures === 0) {
      this.rerun = false
      next = 0
    }
    this.schedule(next)
  }
}
