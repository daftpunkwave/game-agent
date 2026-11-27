/** HTTP lifecycle, routing and optional Kernel services under real composition. */
import * as NativeToolExecutor from '@game-agent/tool-executor-native'
import type { AnonymousUserId } from '@game-agent/anonymous-user-id'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@game-agent/kernel'
import LocalAttachments from '@game-agent/attachment-local'
import AgentRegistry from '@game-agent/agent'
import type { Agent } from '@game-agent/agent'
import AgentLoop from '@game-agent/agent-loop'
import SystemPrompt from '@game-agent/system-prompt'
import ToolRuntime from '@game-agent/tools'
import SessionProjectionRegistry from '@game-agent/session-projection'
import { brandString } from '@game-agent/brand'
import type { AttachmentId } from '@game-agent/attachment/types'
import Loader from '@game-agent/kernel-loader'
import Include from '@game-agent/kernel-include'
import LlmRuntime, { createAssistantMessage, createDeveloperMessage, createSystemMessage, createUserMessage, LlmError, type ToolCallId } from '@game-agent/llm'
import { credentialRef } from '@game-agent/credentials'
import LocalCredentials from '@game-agent/credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import SessionStore, { type SessionId } from '@game-agent/session'
import { MessagesAdapter } from '../src/adapter.ts'
import { MessagesFileStore } from '../src/file-store.ts'
import * as Messages from '@game-agent/llm-messages-api-key'
import MessagesAuth from '@game-agent/messages-auth'
import { adapter, assemble, chunks, MODEL, options, prepareExtensions, resolveAdapterOptions, server, sse, textEvents, TEST_MODELS, user, sourceModuleLoader } from './helpers.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  while (cleanup.length) await cleanup.pop()!()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function endpoint(...args: Parameters<typeof server>) {
  const instance = await server(...args)
  cleanup.push(() => instance.close())
  return instance
}
async function context() {
  const home = await mkdtemp(join(tmpdir(), 'game-agent-messages-test-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  vi.stubEnv('GAME_AGENT_HOME', home)
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  return { ctx, home }
}

async function send(agent: Agent, text: string) {
  agent.followup(user(text))
  await agent.whenIdle()
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
}

declare module '@game-agent/llm' {
  interface MessageSourceMap {
    'saved-notice': { kind: 'saved-notice' }
  }
}

describe('direct Messages HTTP', () => {
  it('continues through Messages with assistant blocks in saved user history', async () => {
    const http = await endpoint()
    const notice = createUserMessage({ source: { kind: 'saved-notice' }, content: [
      { type: 'text', text: 'Background subagent finished.' },
      { type: 'reasoning', text: 'child reasoning' },
      { type: 'tool-call', id: brandString<ToolCallId>('child-call'), name: 'read', arguments: '{}' },
      { type: 'text', text: 'Its closing message: answer.' },
    ] })
    const empty = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'reasoning', text: 'no closing text' }] })
    const history = [notice, empty]
    const saved = JSON.stringify(history)
    const llm = adapter({ baseURL: http.url })
    const first = await assemble(llm.stream(options({ messages: history })))
    const second = await assemble(llm.stream(options({ messages: [...history, first.message, user('continue')] })))

    expect(first.assembler.finish.kind).toBe('stop')
    expect(second.assembler.finish.kind).toBe('stop')
    expect(http.requests).toHaveLength(2)
    const wireNotice = { role: 'user', content: [
      { type: 'text', text: 'Background subagent finished.' },
      { type: 'text', text: 'Its closing message: answer.' },
    ] }
    expect(http.requests[0]?.body.messages).toEqual([wireNotice])
    expect(http.requests[1]?.body.messages).toEqual([
      wireNotice,
      { role: 'assistant', content: [{ type: 'text', text: 'Hello 世界' }] },
      { role: 'user', content: [{ type: 'text', text: 'continue' }] },
    ])
    expect(JSON.stringify(history)).toBe(saved)
  })

  it('continues without a diagnostic callback when replay metadata is unusable', async () => {
    const http = await endpoint()
    const message = createAssistantMessage({ content: [{ type: 'text', text: 'Remember 731.' }], source: {
      provider: 'messages', model: MODEL, replayState: { response: {}, blocks: [] },
    } })
    const response = await assemble(adapter({ baseURL: http.url }).stream(options({ messages: [user(), message, user()] })))
    expect(response.assembler.finish.kind).toBe('stop')
    expect(http.requests[0]?.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Remember 731.' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ])
  })

  it('sends the tool-changes beta header only when update blocks are present', async () => {
    const http = await endpoint()
    const llm = adapter({ baseURL: http.url })
    const tools = [{ name: 'search', description: 'Search', parameters: {}, deferLoading: true as const }]
    const changes = createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'tool-addition', toolName: 'search' }] })
    await assemble(llm.stream(options({ messages: [user(), changes], tools })))
    expect(http.requests[0]).toMatchObject({
      headers: { 'anthropic-beta': 'mid-conversation-tool-changes-2026-07-01' },
      body: { tools: [{ name: 'search', defer_loading: true }], messages: [
        { role: 'user' }, { role: 'system', content: [{ type: 'tool_addition', tool: { type: 'tool_reference', name: 'search' } }] },
      ] },
    })
    await assemble(llm.stream(options({ tools })))
    expect(http.requests[1]?.headers).not.toHaveProperty('anthropic-beta')
  })

  it('surfaces provider rejection of an all-deferred request without adding tools', async () => {
    const message = 'At least one tool must not be deferred'
    const http = await endpoint((response) => {
      response.statusCode = 400
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', message } }))
    })
    const tools = [{ name: 'search', description: 'Search', parameters: {}, deferLoading: true as const }]
    await expect(chunks(adapter({ baseURL: http.url }).stream(options({ tools }))))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', message, failure: { status: 400 } })
    expect(http.requests).toHaveLength(1)
    expect(http.requests[0]?.body.tools).toEqual([
      { name: 'search', description: 'Search', input_schema: {}, defer_loading: true },
    ])
  })

  it('uses the Messages endpoint, authentication, attribution and final usage', async () => {
    const http = await endpoint()
    const llm = adapter({ baseURL: http.url })
    const response = await assemble(llm.stream(options({ model: 'example-flash-next', sessionId: brandString<SessionId>('session-test'), purpose: 'compaction' })), 'example-flash-next')
    expect(response.message.content).toEqual([{ type: 'text', text: 'Hello 世界' }])
    expect(response.message.source).toMatchObject({
      model: 'example-flash-next', replayState: { response: { model: 'example-flash-next' } },
    })
    expect(http.requests[0]).toMatchObject({ path: '/anthropic/v1/messages', headers: {
      'x-api-key': 'test-key', 'anthropic-version': '2023-06-01',
      'user-agent': expect.stringContaining('game-agent/') as string, 'x-game-agent-user-id': 'test-user',
      'x-game-agent-session-id': 'session-test', 'x-game-agent-compact': '1',
    }, body: { thinking: { type: 'enabled' }, output_config: { effort: 'high' } } })
    expect(llm.providerInfo('messages')).toEqual({ id: 'messages', name: 'Messages API' })
    expect(await llm.listModels('messages')).toEqual([])
    expect(await llm.resolveModel('messages', 'example-flash-next')).toMatchObject({
      name: 'Example-V4.1-Flash', inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history',
    })
    expect(await llm.resolveModel('messages', MODEL)).toMatchObject({ id: MODEL })
    expect(llm.imageRequestPricing('messages', MODEL)).toBeDefined()
  })

  it.each([
    ['https://provider.example', 'https://provider.example/v1/messages'],
    ['https://provider.example/v1/', 'https://provider.example/v1/messages'],
    ['https://provider.example/v1beta', 'https://provider.example/v1beta/v1/messages'],
    ['https://provider.example/v2', 'https://provider.example/v2/v1/messages'],
    ['https://provider.example/anthropic', 'https://provider.example/anthropic/v1/messages'],
    ['https://v1.provider.example', 'https://v1.provider.example/v1/messages'],
  ])('resolves the Messages endpoint from %s', async (baseURL, expected) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(sse(textEvents), {
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchImpl)

    await chunks(adapter({ baseURL }).stream(options()))

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(expected)
  })

  it.each([true, false])('maps non-2xx responses (JSON=%s)', async (json) => {
    const http = await endpoint((response) => { response.statusCode = 429; response.setHeader('retry-after', '3'); response.end(json ? JSON.stringify({ error: { type: 'rate_limit_error', message: 'slow down' } }) : '<html>busy</html>') })
    await expect(chunks(adapter({ baseURL: http.url }).stream(options()))).rejects.toMatchObject({ code: 'RATE_LIMIT', failure: { status: 429, providerRetryAfterMs: 3000 } })
  })

  it('refuses redirects before credentials reach another origin or request extensions are accepted', async () => {
    const destination = await endpoint()
    const source = await endpoint((response) => {
      response.writeHead(307, { location: `${destination.url}/v1/messages` })
      response.end()
    })
    const accept = vi.fn(async () => {})
    const prepare = vi.fn(async () => ({ fields: {}, accept }))
    const files = new MessagesFileStore()
    const llm = new MessagesAdapter({
      options: () => resolveAdapterOptions({ baseURL: source.url }),
      resolveAuth: () => Promise.resolve({ headers: { 'x-api-key': 'test-key' } }), resolveUserId: () => 'test-user' as AnonymousUserId,
      resolveAttachments: () => undefined, resolveImageAccess: () => undefined, resolveFiles: () => files,
      prepareExtensions: prepare,
    })
    const error = await chunks(llm.stream(options())).catch((cause: unknown) => cause)
    expect(source.requests).toHaveLength(1)
    expect(source.requests[0]?.headers['x-api-key']).toBe('test-key')
    expect(destination.requests).toEqual([])
    expect(error).toMatchObject({ code: 'TRANSPORT' })
    expect(prepare).toHaveBeenCalledOnce()
    expect(accept).not.toHaveBeenCalled()
  })

  it('freezes endpoint and defaults for a prepared call while the next call sees new settings', async () => {
    const first = await endpoint(), second = await endpoint()
    let config = resolveAdapterOptions({ baseURL: first.url, maxTokens: 10, models: [{ id: MODEL, systemPromptUpdate: 'in-history' }] })
    const files = new MessagesFileStore()
    const llm = new MessagesAdapter({ options: () => config, resolveAuth: snapshot => Promise.resolve({ headers: { 'x-api-key': snapshot.maxTokens === 10 ? 'first' : 'second' } }), resolveUserId: () => 'user' as AnonymousUserId, resolveAttachments: () => undefined, resolveImageAccess: () => undefined, resolveFiles: () => files, prepareExtensions })
    const prepared = await llm.prepareCall('messages', MODEL)
    config = resolveAdapterOptions({ baseURL: second.url, maxTokens: 20 })
    expect(prepared.model.systemPromptUpdate).toBe('in-history')
    expect((await llm.resolveModel('messages', MODEL)).systemPromptUpdate).toBeUndefined()
    await chunks(prepared.stream(options()))
    await chunks(llm.stream(options()))
    expect(first.requests[0]).toMatchObject({ headers: { 'x-api-key': 'first' }, body: { max_tokens: 10 } })
    expect(second.requests[0]).toMatchObject({ headers: { 'x-api-key': 'second' }, body: { max_tokens: 20 } })
  })

  it('aborts an open provider response when its consumer stops', async () => {
    let closed!: () => void
    const stopped = new Promise<void>((resolve) => { closed = resolve })
    const http = await endpoint((response) => {
      response.once('close', closed)
      response.write(sse(textEvents.slice(0, 3)))
    })
    const stream = adapter({ baseURL: http.url }).stream(options())[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ type: 'block-start' })
    await stream.return!()
    await stopped
  })

  it('ends an open provider response when its credential is withdrawn and lets the provider name the failure', async () => {
    const stopped = Promise.withResolvers<undefined>()
    const http = await endpoint((response) => {
      response.once('close', () => { stopped.resolve(undefined) })
      response.write(sse(textEvents.slice(0, 3)))
    })
    const withdrawn = new AbortController()
    const onRequestError = vi.fn(async (error: unknown) => new LlmError('credential withdrawn', 'ACCOUNT_SIGN_IN_REQUIRED', { cause: error }))
    const stream = adapter({ baseURL: http.url }, {
      resolveAuth: () => Promise.resolve({ headers: { 'x-api-key': 'test-key' }, revoked: withdrawn.signal, onRequestError }),
    }).stream(options())[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ type: 'block-start' })
    expect((await stream.next()).value).toMatchObject({ type: 'text-delta' })
    const failed = expect(stream.next()).rejects.toMatchObject({ code: 'ACCOUNT_SIGN_IN_REQUIRED', message: 'credential withdrawn' })
    withdrawn.abort()
    await failed
    await stopped.promise
    expect(onRequestError).toHaveBeenCalledExactlyOnceWith(withdrawn.signal.reason)
  })

  it('reports a withdrawal the provider does not name as a transport failure, without contacting the provider', async () => {
    const http = await endpoint()
    const llm = adapter({ baseURL: http.url }, {
      resolveAuth: () => Promise.resolve({ headers: { 'x-api-key': 'test-key' }, revoked: AbortSignal.abort() }),
    })
    await expect(chunks(llm.stream(options()))).rejects.toMatchObject({ code: 'TRANSPORT' })
    expect(http.requests).toEqual([])
  })

  it('times out an idle HTTP response and closes the connection', async () => {
    const stopped = Promise.withResolvers<undefined>()
    const http = await endpoint((response) => {
      response.once('close', () => { stopped.resolve(undefined) })
      response.write(sse(textEvents.slice(0, 2)))
    })
    // Advance the idle clock after the response is readable, independently of connection setup time.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stream = adapter({ baseURL: http.url, streamIdleTimeoutMs: 30 }).stream(options())[Symbol.asyncIterator]()
    try {
      expect((await stream.next()).value).toMatchObject({ type: 'block-start' })
      const rejected = expect(stream.next()).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(30)
      await rejected
      await stopped.promise
    } finally {
      vi.useRealTimers()
      await stream.return?.()
    }
  })

  it('classifies an already cancelled request without contacting the provider', async () => {
    const http = await endpoint()
    const controller = new AbortController(); controller.abort()
    await expect(chunks(adapter({ baseURL: http.url }).stream(options({ signal: controller.signal })))).rejects.toMatchObject({ code: 'ABORTED' })
    expect(http.requests).toEqual([])
  })

  it('classifies a transport failure', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('network down') })
    await expect(chunks(adapter().stream(options()))).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('preserves the transport failure when a provider error callback rejects', async () => {
    vi.stubGlobal('fetch', async () => new Response('Unauthorized', { status: 401 }))
    const llm = new MessagesAdapter({
      options: () => resolveAdapterOptions({}),
      resolveAuth: () => Promise.resolve({ headers: { 'x-api-key': 'fixture-key' },
        onRequestError: async () => { throw new Error('credential storage unavailable') },
      }),
      resolveUserId: () => 'fixture-user' as import('@game-agent/anonymous-user-id').AnonymousUserId,
      prepareExtensions,
    })
    await expect(chunks(llm.stream(options()))).rejects.toMatchObject({ code: 'AUTH', failure: { status: 401 } })
  })

  it('rejects a successful response with no readable body', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    await expect(chunks(adapter().stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })
})

describe('Kernel provider composition', () => {
  it('declares the replacement immediately after the last baseline tool is removed', async () => {
    const { ctx, http } = await boot()
    const baseline = { name: 'old_tool', description: 'Old tool', parameters: {} }
    const added = { name: 'new_tool', description: 'New tool', parameters: {} }
    const update = createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [
      { type: 'tool-removal', toolName: baseline.name }, { type: 'tool-addition', toolName: added.name },
    ] })
    const request = options({ model: 'example-flash-next', messages: [user(), update], tools: [added],
      toolHistory: { tools: [baseline], updates: [{ messageId: update.id, additions: [added] }] },
    })
    const saved = JSON.stringify(request)
    const response = await assemble(ctx.llm.stream(request), 'example-flash-next')
    expect(response.assembler.finish.kind).toBe('stop')
    expect(http.requests[0]?.body.tools).toEqual([
      { name: added.name, description: added.description, input_schema: {} },
    ])
    expect(http.requests[0]?.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ])
    expect(JSON.stringify(request)).toBe(saved)
  })

  it('resolves an attachment service loaded after the adapter and maps its read-only path', async () => {
    const http = await endpoint()
    const { ctx, home } = await context()
    vi.stubEnv('MODEL_API_KEY', 'test-key')
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    await ctx.plugin(Messages, { baseURL: http.url, models: TEST_MODELS })
    const model = 'example-flash-next'
    const price = () => ctx.llm.imageRequestPricing('messages', model)!
    const dummy = { attachmentId: brandString<AttachmentId>(`sha256:${'a'.repeat(64)}`), width: 1, height: 1, bytes: 3, mediaType: 'image/png' as const }
    expect(price().priceImages([{ type: 'image', attachment: dummy }])[0]?.text).toBeDefined()
    await ctx.plugin(LocalAttachments, { gameAgentHome: home })
    const attachment = await ctx.attachments.saveImage({ data: await readFile(new URL('fixtures/red.png', import.meta.url)), mediaType: 'image/png' })
    expect(price().priceImages([{ type: 'image', attachment }])[0]?.text).not.toContain('/mounted/image.png')
    class MappedFiles extends Service {
      constructor(context: Context) { super(context, 'fs') }
      processPathFromHostPath(_path: string) { return '/mounted/image.png' }
    }
    await ctx.plugin(MappedFiles)
    const message = user()
    await chunks(ctx.llm.stream(options({ model, messages: [{ ...message, content: [...message.content, { type: 'image', attachment }] }] })))
    expect(JSON.stringify(http.requests[0]?.body)).toContain('/mounted/image.png')
    expect(price().priceImages([{ type: 'image', attachment }])[0]?.text).toContain('/mounted/image.png')
  })

  async function boot(...args: Parameters<typeof server>) {
    const http = await endpoint(...args)
    const { ctx, home } = await context()
    vi.stubEnv('MODEL_API_KEY', '')
    await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  MODEL_API_KEY: stored-key\n', { mode: 0o600 })
    const template = await readFile(new URL('fixtures/game-agent.yml', import.meta.url), 'utf8')
    await writeFile(join(home, 'game-agent.yml'), template.replaceAll('{{endpoint}}', JSON.stringify(http.url)).replaceAll('{{credentials}}', JSON.stringify(join(home, '.credentials.yaml'))))
    ctx.baseUrl = pathToFileURL(home).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@game-agent/llm', LlmRuntime], ['@game-agent/llm-messages-api-key', Messages],
      ['@game-agent/credentials-local', LocalCredentials], ['@game-agent/messages-auth', MessagesAuth],
      ['@game-agent/agent', AgentRegistry], ['@game-agent/agent-loop', AgentLoop],
      ['@game-agent/session', SessionStore], ['@game-agent/session-projection', SessionProjectionRegistry],
      ['@game-agent/system-prompt', SystemPrompt], ['@game-agent/tools', ToolRuntime],
      ['@game-agent/tool-executor-native', NativeToolExecutor],
    ])
    // The importer supplies source modules while Loader still owns configuration and effects.
    for (const name of modules.keys()) {
      const directory = join(home, 'node_modules', name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '0.1.3-alpha.1', type: 'module' }))
    }
    ctx.loader.internal = sourceModuleLoader(async (name) => {
      if (!modules.has(name)) throw new Error(`unexpected module ${name}`)
      return modules.get(name)
    })
    await profileComposition(ctx, home, join(home, 'game-agent.yml'))
    return { ctx, http }
  }

  it.each([
    JSON.stringify({ error: { type: 'authentication_error', message: 'API key is invalid' } }),
    JSON.stringify({ error: { message: 'Authentication Fails (invalid token)' } }),
    'Unauthorized',
    '',
  ])('handles HTTP 401 independently of the response body (%s)', async (body) => {
    const { ctx } = await boot((response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(body)
    })
    expect((await chunks(ctx.llm.stream(options()))).at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } },
    })
  })

  it.each([
    { model: MODEL, inHistory: false },
    { model: MODEL, inHistory: true },
    { model: 'example-flash-next', inHistory: true },
  ])('updates, clears and restores prompts across continued and resumed sessions, model=$model in-history=$inHistory', async ({ model, inHistory }) => {
    const { ctx, http } = await boot()
    if (inHistory && model === MODEL) await ctx.settings.update(Messages.name, { models: [{ id: model, systemPromptUpdate: 'in-history' }] })
    let prompt = 'first prompt'
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
      ...await next(), sections: [{ name: 'test', text: prompt, replacement: prompt === '' ? 'The prior prompt is inactive.' : '', order: 0 }],
    }))
    const agentOptions = { provider: 'messages', model }
    const agent = await ctx.agentLoop.create(brandString<SessionId>('prompt-update'), agentOptions)
    await send(agent, 'first')
    prompt = 'second prompt'
    await send(agent, 'second')
    const count = agent.session.snapshotEvents().filter(event => event.type === 'system/message').length
    await send(agent, 'unchanged')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'system/message')).toHaveLength(count)
    prompt = ''
    await send(agent, 'clear')
    const { agent: resumed } = await ctx.agents.create({ sessionId: brandString<SessionId>('prompt-resume'), agentOptions,
      seed: [...agent.session.snapshotEvents()] })
    await send(resumed, 'resume cleared')
    prompt = 'restored prompt'
    await send(resumed, 'restore')
    expect(http.requests.map(request => request.body.system)).toEqual(inHistory
      ? Array(6).fill('first prompt')
      : ['first prompt', 'first prompt\n\nsecond prompt', 'first prompt\n\nsecond prompt',
        'first prompt\n\nsecond prompt\n\nThe prior prompt is inactive.',
        'first prompt\n\nsecond prompt\n\nThe prior prompt is inactive.',
        'first prompt\n\nsecond prompt\n\nThe prior prompt is inactive.\n\nrestored prompt'])
    for (const [index, request] of http.requests.entries()) {
      const messages = request.body.messages as { role: string; content: unknown[] }[]
      expect(messages.filter(message => message.role === 'assistant')).toHaveLength(index)
      const updates: string[] = []
      if (inHistory && index >= 1) updates.push('second prompt')
      if (inHistory && index >= 3) updates.push('The prior prompt is inactive.')
      if (inHistory && index >= 5) updates.push('restored prompt')
      expect(messages.filter(message => message.role === 'system').map(message => message.content))
        .toEqual(updates.map(text => [{ type: 'text', text }]))
      expect(JSON.stringify(messages.filter(message => message.role !== 'system'))).not.toMatch(/first prompt|second prompt|restored prompt/)
    }
    expect(resumed.session.requestContext()?.systemPromptUpdate).toBe(inHistory ? 'in-history' : undefined)
  })

  it.each([false, true])('continues and resumes sessions after a model capability change, in-history=%s', async (inHistory) => {
    const { ctx, http } = await boot()
    await ctx.settings.update(Messages.name, { baseURL: http.url, models: [{ id: MODEL, systemPromptUpdate: 'in-history' }] })
    let prompt = 'old prompt'
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
      ...await next(), sections: [{ name: 'test', text: prompt, replacement: prompt === '' ? 'The prior prompt is inactive.' : '', order: 0 }],
    }))
    const agentOptions = { provider: 'messages', model: MODEL }
    const agent = await ctx.agentLoop.create(brandString<SessionId>('capability-switch'), agentOptions)
    await send(agent, 'first')
    prompt = 'current prompt'
    await send(agent, 'second')
    expect((http.requests[1]?.body.messages as { role: string }[]).filter(message => message.role === 'system')).toHaveLength(1)
    const seed = [...agent.session.snapshotEvents()]
    const saved = JSON.stringify(seed)
    await ctx.settings.update(Messages.name, { models: [{ id: MODEL, ...inHistory ? { systemPromptUpdate: 'in-history' } : {} }] })
    await send(agent, 'switch')
    const { agent: resumed } = await ctx.agents.create({ sessionId: brandString<SessionId>('switch-resume'), agentOptions: agentOptions, seed })
    await send(resumed, 'resume')
    for (const request of http.requests.slice(2)) {
      expect(request.path).toBe('/anthropic/v1/messages')
      expect(request.body.system).toBe(inHistory ? 'old prompt' : 'old prompt\n\ncurrent prompt')
      const messages = request.body.messages as { role: string }[]
      expect(messages.filter(message => message.role === 'assistant')).toHaveLength(2)
      expect(messages.filter(message => message.role === 'system')).toHaveLength(inHistory ? 1 : 0)
      expect(JSON.stringify(messages.filter(message => message.role !== 'system'))).not.toMatch(/old prompt|current prompt/)
    }
    expect(JSON.stringify(seed)).toBe(saved)
    expect(agent.session.deriveMessages().filter(message => message.role === 'system')).toHaveLength(2)
    expect(resumed.session.deriveMessages().filter(message => message.role === 'system')).toHaveLength(2)
  })

  it('preserves all system additions on direct compaction calls', async () => {
    const { ctx, http } = await boot()
    const history = [createSystemMessage('old'), user(),
      createAssistantMessage({ content: [{ type: 'text', text: 'OK' }], source: { provider: 'messages', model: MODEL } }),
      createSystemMessage('current'), user('summarize')]
    const saved = JSON.stringify(history)
    const response = await assemble(ctx.llm.stream(options({ messages: history, purpose: 'compaction' })))
    expect(response.assembler.finish.kind).toBe('stop')
    expect(http.requests[0]?.body.system).toBe('old\n\ncurrent')
    expect((http.requests[0]?.body.messages as { role: string }[]).map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(history)).toBe(saved)
  })

  it('loads one provider from YAML, rotates settings and credentials, then removes disposed registrations', async () => {
    const { ctx, http } = await boot()
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['messages'])
    expect((await assemble(ctx.llm.stream(options()))).assembler.finish.kind).toBe('stop')
    expect(http.requests[0]?.headers['x-api-key']).toBe('stored-key')
    const second = await endpoint()
    await ctx.settings.update(Messages.name, { baseURL: second.url, maxTokens: 51, retryPolicy: { mode: 'always' } })
    await ctx.credentials.set(credentialRef('MODEL_API_KEY'), 'rotated')
    await chunks(ctx.llm.stream(options()))
    expect(second.requests[0]).toMatchObject({ headers: { 'x-api-key': 'rotated' }, body: { max_tokens: 51 } })
    await ctx.settings.update(Messages.name, { models: [{ id: 'duplicate' }, { id: 'duplicate' }], baseURL: http.url })
    const refused: unknown = (await chunks(ctx.llm.stream(options()))).find(chunk => chunk.type === 'finish')
    expect(JSON.stringify(refused)).toContain('duplicate catalog model')
    expect(second.requests).toHaveLength(1)
    expect(http.requests).toHaveLength(1)
    await ctx.settings.update(Messages.name, { models: [{ id: MODEL }], baseURL: http.url })
    await chunks(ctx.llm.stream(options()))
    expect(http.requests).toHaveLength(2)
    const llm = ctx.llm
    await ctx.fiber.dispose()
    expect(llm.listProviders()).toEqual([])
    expect(llm.listConfigurableProviders()).toEqual([])
  })

  it('uses environment credentials and reports missing or malformed keys without network access', async () => {
    const http = await endpoint()
    const { ctx } = await context()
    vi.stubEnv('MODEL_BASE_URL', http.url)
    vi.stubEnv('MODEL_API_KEY', 'env-key')
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MessagesAuth)
    const fiber = ctx.plugin(Messages)
    await fiber
    await chunks(ctx.llm.stream(options()))
    expect(http.requests[0]?.headers['x-api-key']).toBe('env-key')
    vi.stubEnv('MODEL_API_KEY', '')
    expect((await assemble(ctx.llm.stream(options()))).assembler.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    vi.stubEnv('MODEL_API_KEY', 'bad\nkey')
    expect((await assemble(ctx.llm.stream(options()))).assembler.finish).toMatchObject({ kind: 'error', failure: { code: 'INVALID_CREDENTIAL' } })
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })
})

it('rejects invalid catalog context windows at the options resolver', () => {
  expect(() => resolveAdapterOptions({ models: [{ id: 'invalid-window', contextWindow: 0 }] })).toThrow('contextWindow must be a positive integer')
})


it('sends the API key in x-api-key to the configured endpoint', async () => {
  vi.stubEnv('MODEL_API_KEY', 'ambient-key')
  const { ctx } = await context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MessagesAuth)
  await ctx.plugin(Messages, { baseURL: 'https://custom.example.test' })
  const request = vi.fn<typeof fetch>((_input, init) => {
    const headers = new Headers(init?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.get('x-api-key')).toBe('ambient-key')
    expect(init?.redirect).toBe('error')
    return Promise.resolve(new Response(sse(textEvents), { status: 200 }))
  })
  vi.stubGlobal('fetch', request)
  await assemble(ctx.llm.stream(options()))
  expect(request).toHaveBeenCalledOnce()
})
