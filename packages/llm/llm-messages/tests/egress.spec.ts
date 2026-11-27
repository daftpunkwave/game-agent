import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { installProxyFromEnvironment } from '@game-agent/http-proxy'

let seen: string[] = []
let proxy: Server
let proxyUrl: string

beforeAll(async () => {
  proxy = createServer((request, response) => {
    seen.push(`REQ ${request.url ?? ''}`)
    response.writeHead(502); response.end('fake-proxy')
  })
  proxy.on('connect', (request, socket) => {
    seen.push(`CONNECT ${request.url ?? ''}`)
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); socket.end()
  })
  const a = await new Promise<AddressInfo>((r) => { proxy.listen(0, '127.0.0.1', () => { r(proxy.address() as AddressInfo) }) })
  proxyUrl = `http://127.0.0.1:${String(a.port)}`
})
afterAll(async () => { await new Promise<void>((r) => { proxy.close(() => { r() }) }) })

/** The launch environment of a user who exported one proxy for both schemes. */
function proxyEnv(): { get(name: string): { value: string } | undefined } {
  return { get: name => (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' ? { value: proxyUrl } : undefined) }
}
async function observe(run: () => Promise<unknown>): Promise<string[]> {
  seen = []
  const dispose = await installProxyFromEnvironment(proxyEnv(), () => undefined)
  try { await run().catch(() => undefined) } finally { await dispose() }
  return seen
}
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { Context } from '@game-agent/kernel'
import LlmRuntime from '@game-agent/llm'
import LlmApiExtensionRegistry from '@game-agent/llm-api-extensions'
import * as LlmMessages from '@game-agent/llm-messages-api-key'
import MessagesAuth from '@game-agent/messages-auth'

let home: string
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'game-agent-example-egress-'))
  vi.stubEnv('GAME_AGENT_HOME', home)
  vi.stubEnv('MODEL_API_KEY', 'probe-key')
})
afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

/** Drive the shipping adapter's Messages request at an unresolvable endpoint. */
async function streamOnce(): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmApiExtensionRegistry)
  await ctx.plugin(MessagesAuth)
  await ctx.plugin(LlmMessages, { baseURL: 'http://example-probe.invalid/v1', models: [{ id: 'm' }] })
  for await (const _chunk of ctx.llm.stream({ provider: 'messages', model: 'm', messages: [] })) {
    // The endpoint never answers; the proxy record is the assertion.
  }
}

describe('llm-messages egress', () => {
  it('sends the Messages request through the proxy', async () => {
    const observed = await observe(streamOnce)
    expect(observed.join('|')).toContain('example-probe.invalid')
  })
})
