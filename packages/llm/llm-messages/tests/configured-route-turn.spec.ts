/** Turns on a configured endpoint report credential failures on the model request, after the prompt is recorded. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@game-agent/kernel'
import LlmRuntime, { createUserMessage } from '@game-agent/llm'
import AgentRegistry from '@game-agent/agent'
import AgentLoop from '@game-agent/agent-loop'
import SessionStore, { type SessionId } from '@game-agent/session'
import SessionProjectionRegistry from '@game-agent/session-projection'
import SystemPrompt from '@game-agent/system-prompt'
import ToolRuntime from '@game-agent/tools'
import * as NativeToolExecutor from '@game-agent/tool-executor-native'
import * as ApiKey from '@game-agent/llm-messages-api-key'
import MessagesAuth from '@game-agent/messages-auth'
import { brandString } from '@game-agent/brand'
import { TEST_BASE_URL, TEST_MODELS } from './helpers.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('records the prompt and fails the request when the configured endpoint has a malformed key', async () => {
  vi.stubEnv('MODEL_API_KEY', 'invalid\nheader')
  const fetch = vi.spyOn(globalThis, 'fetch')
  const ctx = new Context()
  contexts.push(ctx)
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) {
    await ctx.plugin(plugin)
  }
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessagesAuth)
  await ctx.plugin(ApiKey, { baseURL: TEST_BASE_URL, models: TEST_MODELS })
  const agent = await ctx.agentLoop.create(brandString<SessionId>('malformed-configured-key'), { provider: 'messages', model: 'example-flash-next' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  expect(events.map(event => event.type)).toContain('user/message')
  expect(events.find(event => event.type === 'assistant/attempt')?.data).toMatchObject({
    stream: [{ chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_CREDENTIAL' } } } }],
  })
  expect(fetch).not.toHaveBeenCalled()
})
