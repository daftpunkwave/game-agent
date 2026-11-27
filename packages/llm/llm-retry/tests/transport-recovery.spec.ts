import { createUserMessage, expandAssistantStream } from '@game-agent/llm'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@game-agent/kernel'
import type { Agent } from '@game-agent/agent'
import AgentLoop from '@game-agent/agent-loop'
import { mountAgentLoopTestDependencies } from '@game-agent/agent-loop-testkit'
import * as LlmMessages from '@game-agent/llm-messages-api-key'
import type { MockLlmBehavior, MockLlmServer } from '@game-agent/llm-mock-server'
import { startMockLlmServer } from '@game-agent/llm-mock-server'
import type { SessionId } from '@game-agent/session'
import type { SessionEvent } from '@game-agent/session'
import * as Retry from '../src/index.ts'
import MessagesAuth from '@game-agent/messages-auth'
import { brandString } from '@game-agent/brand'

let context: Context | undefined
const servers: Promise<MockLlmServer>[] = []
let failureDiagnostics: (() => object) | undefined

afterEach(async (test) => {
  const diagnose = failureDiagnostics
  failureDiagnostics = undefined
  // Capture the pending request before disposal aborts it and closes its socket.
  if (test.task.result?.state === 'fail' && diagnose !== undefined) {
    console.error('transport recovery failure:', JSON.stringify(diagnose()))
  }
  const ownedContext = context
  context = undefined
  // A failed transport can still await a stalled socket while its context disposes.
  const results = await Promise.allSettled([
    ownedContext?.fiber.dispose(),
    ...servers.splice(0).map(async server => (await server).close()),
  ])
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
})

function start(
  sequence: readonly MockLlmBehavior[],
  options: Omit<Parameters<typeof startMockLlmServer>[0], 'sequence'> = {},
): Promise<MockLlmServer> {
  const server = startMockLlmServer({ sequence, ...options })
  servers.push(server)
  return server
}

async function rig(
  baseURL: string,
  options: { streamIdleTimeoutMs?: number; initialDelayMs?: number } = {},
): Promise<Context> {
  vi.stubEnv('MODEL_API_KEY', 'mock-key')
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MessagesAuth)
  await ctx.plugin(LlmMessages, {
    baseURL,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs ?? 1_000,
    retryPolicy: {
      mode: 'normal',
      maxRetries: 2,
      backoff: {
        initialDelayMs: options.initialDelayMs ?? 10,
        maxDelayMs: options.initialDelayMs ?? 10,
        jitterRatio: 0,
      },
    },
  })
  await ctx.plugin(Retry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}

function sendAndWait(ctx: Context, agent: Agent): Promise<void> {
  const idle = waitForIdle(ctx, agent)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover through the provider boundary' }], source: { kind: 'user' } }))
  return idle
}

function finalAssistantText(agent: Agent): string | undefined {
  const message = agent.session.deriveMessages().at(-1)
  if (message?.role !== 'assistant') return undefined
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  return port
}

describe('bounded retry through the real Messages HTTP/SSE adapter', () => {
  it('recovers from a true refused connection after the endpoint starts during backoff', async () => {
    const port = await unusedPort()
    context = await rig(`http://127.0.0.1:${port}`, { initialDelayMs: 100 })
    const agent = await context.agentLoop.create(brandString<SessionId>('wire-refused'), {
      provider: 'messages',
      model: 'mock-model',
    })
    let recoveryServer: Promise<MockLlmServer> | undefined
    context.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'llm/retry' || event.data.retry !== 1) return
      recoveryServer = start(['success'], { port, apiKey: 'mock-key', successText: 'connected after retry' })
    })

    await sendAndWait(context, agent)
    const server = await recoveryServer

    expect(server).toBeDefined()
    expect(server?.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start')
      .map(event => [event.data.turn, event.data.step]))
      .toEqual([[1, 1]])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data.failure.code))
      .toEqual(['TRANSPORT'])
    expect(finalAssistantText(agent)).toBe('connected after retry')
  })

  it.each([
    ['stream_disconnect', 1] as const,
    ['partial_disconnect', 3] as const,
  ])('retries %s without committing failed chunks', async (behavior, failedChunkCount) => {
    const server = await start([behavior, 'success'], {
      apiKey: 'mock-key',
      partialText: 'discard me',
      chunkSize: 100,
      disconnectDelayMs: 20,
      successText: 'recovered response',
    })
    context = await rig(server.baseURL)
    const agent = await context.agentLoop.create(brandString<SessionId>(`wire-${behavior}`), {
      provider: 'messages',
      model: 'mock-model',
    })

    await sendAndWait(context, agent)

    expect(server.requests).toHaveLength(2)
    expect(server.requests[0]?.body).toEqual(server.requests[1]?.body)
    const retryEvent = agent.session.snapshotEvents().find(event => event.type === 'llm/retry')
    const failedAttempts = agent.session.snapshotEvents().filter((event): event is SessionEvent<'assistant/attempt'> =>
      event.type === 'assistant/attempt'
      && retryEvent !== undefined
      && event.seq < retryEvent.seq,
    )
    expect(failedAttempts).toHaveLength(1)
    expect(expandAssistantStream(failedAttempts[0]!.data.stream)).toHaveLength(failedChunkCount)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
      .map(event => [event.data.turn, event.data.step]))
      .toEqual([[1, 1]])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data.failure.code))
      .toEqual(['TRANSPORT'])
    expect(finalAssistantText(agent)).toBe('recovered response')
  })

  it('retries a wire-valid content-less completion without committing an empty message', async () => {
    const server = await start(['empty', 'success'], {
      apiKey: 'mock-key',
      successText: 'recovered from empty',
    })
    context = await rig(server.baseURL)
    const agent = await context.agentLoop.create(brandString<SessionId>('wire-empty'), {
      provider: 'messages',
      model: 'mock-model',
    })

    await sendAndWait(context, agent)

    expect(server.requests).toHaveLength(2)
    expect(server.requests[0]?.body).toEqual(server.requests[1]?.body)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data.failure.code))
      .toEqual(['EMPTY_RESPONSE'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
      .map(event => [event.data.turn, event.data.step]))
      .toEqual([[1, 1]])
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    expect(finalAssistantText(agent)).toBe('recovered from empty')
  })

  it('exposes a clean partial EOF as non-default-retryable STREAM_CLOSED', async () => {
    const server = await start(['partial_eof', 'success'], {
      apiKey: 'mock-key',
      partialText: 'discarded clean eof',
      chunkSize: 100,
    })
    context = await rig(server.baseURL)
    const agent = await context.agentLoop.create(brandString<SessionId>('wire-partial-eof'), {
      provider: 'messages',
      model: 'mock-model',
    })

    await sendAndWait(context, agent)

    expect(server.requests).toHaveLength(1)
    const attempt = agent.session.snapshotEvents().find(event => event.type === 'assistant/attempt' && event.data.turn === 1)
    expect(attempt?.type === 'assistant/attempt' ? expandAssistantStream(attempt.data.stream) : []).toHaveLength(3)
    expect(agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)
    expect(agent.session.snapshotEvents().some(event => event.type === 'llm/retry')).toBe(false)
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { message: 'Messages stream ended before message_stop', code: 'STREAM_CLOSED' } } },
    })
  })

  it('turns a stalled body into TIMEOUT and succeeds on the next request', async () => {
    const started = performance.now()
    let phase = 'starting server'
    const observed: { server?: MockLlmServer; agent?: Agent } = {}
    let idleSettled = false
    failureDiagnostics = () => {
      const events = observed.agent?.session.snapshotEvents() ?? []
      return {
        node: process.version,
        phase,
        elapsedMs: Math.round(performance.now() - started),
        idleSettled,
        agentStatus: observed.agent?.status,
        requestCount: observed.server?.requests.length ?? 0,
        requests: observed.server?.requests.map(({ attempt, behavior, outcome, chunksSent }) =>
          ({ attempt, behavior, outcome, chunksSent })),
        retries: events.filter(event => event.type === 'llm/retry').map(event => event.data),
        lastEvents: events.slice(-10).map(event => ({ seq: event.seq, type: event.type })),
      }
    }
    const server = await start(['stall', 'success'], {
      apiKey: 'mock-key',
      successText: 'recovered after timeout',
    })
    observed.server = server
    phase = 'mounting context'
    // This crosses the real HTTP idle timer, so leave scheduler slack between
    // the stalled attempt and the mock server's immediate successful response.
    context = await rig(server.baseURL, { streamIdleTimeoutMs: 1_000 })
    phase = 'creating agent'
    const agent = await context.agentLoop.create(brandString<SessionId>('wire-stall'), {
      provider: 'messages',
      model: 'mock-model',
    })

    observed.agent = agent
    phase = 'awaiting agent idle'
    await sendAndWait(context, agent).finally(() => { idleSettled = true })
    phase = 'asserting recovery'

    expect(server.requests.map(record => record.behavior)).toEqual(['stall', 'success'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data.failure.code))
      .toEqual(['TIMEOUT'])
    expect(finalAssistantText(agent)).toBe('recovered after timeout')
  })

  it('turns a body that never observes the abort into TIMEOUT and succeeds on the next request', async () => {
    const server = await start(['success'], {
      apiKey: 'mock-key',
      successText: 'recovered from an ignored abort',
    })
    const realFetch = globalThis.fetch
    let attempts = 0
    // A transport that ignores the abort on an in-flight read, as undici does when
    // the abort lands on a pending body read: the abandoned read never settles, so
    // only the idle deadline can end this attempt.
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1
      if (attempts > 1) return realFetch(input, init)
      return Promise.resolve(new Response(
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ))
    })
    context = await rig(server.baseURL, { streamIdleTimeoutMs: 1_000 })
    const agent = await context.agentLoop.create(brandString<SessionId>('wire-ignored-abort'), {
      provider: 'messages',
      model: 'mock-model',
    })

    await sendAndWait(context, agent)

    expect(attempts).toBe(2)
    expect(server.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry').map(event => event.data.failure.code))
      .toEqual(['TIMEOUT'])
    expect(finalAssistantText(agent)).toBe('recovered from an ignored abort')
  })

  it('stops after the configured transport retry budget is exhausted', async () => {
    const server = await start(['connection_reset', 'connection_reset', 'connection_reset'], {
      apiKey: 'mock-key',
    })
    context = await rig(server.baseURL)
    const agent = await context.agentLoop.create(brandString<SessionId>('wire-exhausted'), {
      provider: 'messages',
      model: 'mock-model',
    })

    await sendAndWait(context, agent)

    expect(server.requests).toHaveLength(3)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'llm/retry')).toHaveLength(2)
    const end = agent.session.snapshotEvents().at(-1)
    expect(end).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'TRANSPORT' } } },
    })
    if (end?.type === 'turn/end' && end.data.reason.kind === 'error') {
      expect(end.data.reason.error.message).toBe('Messages transport failed')
    }
  })
})
