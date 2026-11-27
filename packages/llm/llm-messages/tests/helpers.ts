/** Deterministic Messages fixtures and loopback transport with explicit teardown. */
import { Context } from '@game-agent/kernel'
import AttachmentStore from '@game-agent/attachment'
import type { ModuleLoaderV2 } from '@game-agent/kernel-loader'
import type { AnonymousUserId } from '@game-agent/anonymous-user-id'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { object } from '../src/replay.ts'
import { BlockAssembler, createAssistantMessage, createUserMessage } from '@game-agent/llm'
import type { GenerateOptions, StreamChunk } from '@game-agent/llm'
import { resolveAdapterOptions as resolveConnection } from '../src/index.ts'
import { MessagesAdapter } from '../src/adapter.ts'
import type { Options as Config } from '../src/config.ts'
import type { MessagesAdapterOptions, MessagesCatalogModel } from '../src/types.ts'
import { MessagesFileStore } from '../src/file-store.ts'

export const prepareExtensions = async () => ({ fields: {}, accept: async () => {} })

/** Endpoint the tests resolve against; a deployment configures its own. */
export const TEST_BASE_URL = 'https://api.example.test/anthropic'

/**
 * The options resolver with the settings a deployment must supply defaulted for tests: the endpoint
 * {@link TEST_BASE_URL} and the catalog {@link TEST_MODELS}. An explicit setting, or a launch environment that names
 * `MODEL_BASE_URL`, wins.
 */
export const resolveAdapterOptions: typeof resolveConnection = (config, environment) => resolveConnection({
  ...environment?.get('MODEL_BASE_URL') === undefined ? { baseURL: TEST_BASE_URL } : {},
  models: TEST_MODELS,
  ...config,
}, environment)

/** The model catalog the composition tests configure: a vision model that updates its system prompt in history, and a text model. */
export const TEST_MODELS = [
  {
    id: 'example-flash-next',
    name: 'Example-V4.1-Flash',
    contextWindow: 1_048_576,
    inputModalities: ['text', 'image'],
    systemPromptUpdate: 'in-history',
    toolUpdate: 'addition-only',
  },
  {
    id: 'example-pro',
    name: 'Example-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: 1_048_576,
  },
] satisfies MessagesCatalogModel[]

export const MODEL = 'example-flash'
export const user = (text = 'hello') => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
export const options = (overrides: Partial<GenerateOptions> = {}): GenerateOptions => ({ provider: 'messages', model: MODEL, messages: [user()], ...overrides })
export const start = { type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: { input_tokens: 12, output_tokens: 1 } } }
export const end = (reason = 'end_turn') => [
  { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
]
export const textEvents = [start,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello 世界' } },
  { type: 'content_block_stop', index: 0 }, ...end()]
export const sse = (events: unknown[]) => events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
export async function* events(values: Record<string, unknown>[]) { yield* values }
export async function chunks(stream: AsyncIterable<StreamChunk>) {
  const result: StreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
export async function assemble(stream: AsyncIterable<StreamChunk>, model = MODEL) {
  const assembler = new BlockAssembler()
  const output = await chunks(stream)
  for (const chunk of output) assembler.push(chunk)
  const message = createAssistantMessage({ content: assembler.blocks(), source: { provider: 'messages', model, ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState } } })
  return { output, message, assembler }
}
export function adapter(config: Config = {}, dependencies: Partial<MessagesAdapterOptions> = {}) {
  const files = new MessagesFileStore()
  return new MessagesAdapter({ options: () => resolveAdapterOptions(config), resolveAuth: () => Promise.resolve({ headers: { 'x-api-key': 'test-key' } }), resolveUserId: () => 'test-user' as AnonymousUserId, resolveAttachments: () => undefined, resolveImageAccess: () => undefined, resolveFiles: () => files, prepareExtensions, ...dependencies })
}
/**
 * Loopback Messages endpoint recording each model request.
 * @param reply - answers each Messages request.
 * @param listing - JSON body served for `GET /models`; omission leaves that request unanswered like any other.
 * @returns the endpoint base URL, recorded requests, and teardown.
 */
export async function server(
  reply: (response: ServerResponse, count: number) => void = response => response.end(sse(textEvents)),
  listing?: unknown,
) {
  const requests: { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = []
  const http = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => response.destroy(error as Error))
  })
  async function handle(request: import('node:http').IncomingMessage, response: ServerResponse) {
    if (listing !== undefined && request.method === 'GET' && request.url === '/models') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(listing))
      return
    }
    const parts: Buffer[] = []
    for await (const part of request as AsyncIterable<Buffer>) parts.push(part)
    requests.push({ path: request.url!, headers: request.headers, body: object(JSON.parse(Buffer.concat(parts).toString())) })
    response.setHeader('content-type', 'text/event-stream')
    reply(response, requests.length)
  }
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('missing loopback port')
  return {
    url: `http://127.0.0.1:${address.port}/anthropic`, requests,
    async close() {
      const closed = new Promise<void>((resolve, reject) => http.close((error) => {
        if (error) reject(error)
        else resolve()
      }))
      http.closeAllConnections()
      await closed
    },
  }
}

/**
 * Parse the `multipart/form-data` body of a recorded Files upload the way a server receives it.
 * @param init - request options that the Files client passed to `fetch`.
 * @returns the decoded form fields.
 */
export async function uploadedForm(init: RequestInit | undefined): Promise<FormData> {
  const body = init?.body
  if (!(body instanceof Uint8Array)) throw new Error('expected an encoded multipart body')
  return await new Request('http://localhost/v1/files', { method: 'POST', headers: new Headers(init?.headers), body }).formData()
}

/** Supply only the image projection operation; any unexpected storage work fails. */
export function requestImageStore(readImageRequest: AttachmentStore['readImageRequest']): AttachmentStore {
  class ProjectedAttachments extends AttachmentStore {
    get imageLimits(): never { throw new Error('unexpected image policy read') }
    validateImage(): never { throw new Error('unexpected image validation') }
    saveImage(): never { throw new Error('unexpected image save') }
    readImage(): never { throw new Error('unexpected original image read') }
    override readImageRequest = readImageRequest
  }
  return new ProjectedAttachments(new Context())
}

/** Import mapped source modules without claiming support for Node's HMR internals. */
export function sourceModuleLoader(importModule: (specifier: string) => Promise<unknown>): ModuleLoaderV2 {
  return {
    version: 'v2',
    import: importModule,
    loadCache: new Map(),
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
}
