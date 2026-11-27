import { executeToolFixture } from '@game-agent/tool-testkit'
// Proves `allowParallelInProgress` is real configurability and not a constant:
// the flag is set in a game-agent.yml booted through the real Loader, and both faces
// it controls — the model-facing description and the accepted input — follow it.
import * as NativeToolExecutor from '@game-agent/tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@game-agent/kernel'
import Loader from '@game-agent/kernel-loader'
import Include from '@game-agent/kernel-include'
import { brandString } from '@game-agent/brand'
import type { ToolCallId } from '@game-agent/llm/types'
import { Session, type SessionId } from '@game-agent/session'
import AgentRegistry from '@game-agent/agent'
import type { Agent } from '@game-agent/agent'
import SystemPrompt from '@game-agent/system-prompt'
import ToolRuntime from '@game-agent/tools'
import SessionProjectionRegistry from '@game-agent/session-projection'
import * as ToolTodo from '@game-agent/tool-todo'
import { unsupportedModel, unsupportedInbox } from '@game-agent/agent-loop-testkit'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = brandString<SessionId>('todo-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Boot a game-agent.yml carrying the given tool-todo config block.
 * @param configLines - YAML lines nested under the tool's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'game-agent-todo-loader-'))
  const configPath = join(root, 'game-agent.yml')
  await writeFile(configPath, [
    "- name: '@game-agent/agent'",
    "- name: '@game-agent/system-prompt'",
    "- name: '@game-agent/tools'",
    "- name: '@game-agent/tool-executor-native'",
    "- name: '@game-agent/session-projection'",
    "- name: '@game-agent/tool-todo'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@game-agent/agent', AgentRegistry],
    ['@game-agent/system-prompt', SystemPrompt],
    ['@game-agent/tools', ToolRuntime],
    ['@game-agent/tool-executor-native', NativeToolExecutor],
    ['@game-agent/session-projection', SessionProjectionRegistry],
    ['@game-agent/tool-todo', ToolTodo],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'kernel:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

const PARALLEL_TODOS = [
  { content: 'run subagent a', status: 'in_progress' },
  { content: 'run subagent b', status: 'in_progress' },
]

describe('tool-todo real Loader composition through game-agent.yml', () => {
  it('allowParallelInProgress: false narrows the description and rejects a parallel write', async () => {
    const ctx = await boot(['    allowParallelInProgress: false'])
    const description = ctx.tools.schemas().find(s => s.name === 'todo_write')?.description ?? ''
    expect(description).toContain('keep exactly one todo `in_progress`')
    expect(description).not.toContain('several only')

    const owner = await agent(ctx)
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: brandString<ToolCallId>('parallel'),
      name: 'todo_write',
      arguments: { todos: PARALLEL_TODOS },
      agent: owner,
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('at most one task may be in_progress')
    expect(result.error?.info).toEqual({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect(owner.session.snapshotEvents().some(e => e.type === 'todo/write')).toBe(false)
  }, 30_000)

  it('allowParallelInProgress: true permits a parallel write end to end', async () => {
    const ctx = await boot(['    allowParallelInProgress: true'])
    const description = ctx.tools.schemas().find(s => s.name === 'todo_write')?.description ?? ''
    expect(description).toContain('several only when work runs in parallel')

    const owner = await agent(ctx)
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: brandString<ToolCallId>('parallel-enabled'),
      name: 'todo_write',
      arguments: { todos: PARALLEL_TODOS },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(owner.session.snapshotEvents().findLast(e => e.type === 'todo/write')?.data.todos).toEqual(PARALLEL_TODOS)
  }, 30_000)

  it.each([
    { label: 'is omitted', configLines: [], failure: '$.allowParallelInProgress missing required value' },
    { label: 'is not boolean', configLines: ['    allowParallelInProgress: "no"'], failure: '$.allowParallelInProgress expected boolean' },
  ])('fails loading when allowParallelInProgress $label', async ({ configLines, failure }) => {
    // The policy is self-contained, so misconfiguration fails at load: the
    // entry's apply rejects and boot never reaches a running tool.
    await expect(boot(configLines)).rejects.toThrow(failure)
  }, 30_000)
})
