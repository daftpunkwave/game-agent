import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@game-agent/kernel'
import Loader from '@game-agent/kernel-loader'
import Include from '@game-agent/kernel-include'
import SessionProjectionRegistry from '@game-agent/session-projection'
import AgentRegistry from '@game-agent/agent'
import type { Agent, AgentStatus } from '@game-agent/agent'
import CommandRuntime from '@game-agent/commands'
import SessionStore, { type SessionId } from '@game-agent/session'
import * as CommandFeedback from '@game-agent/command-feedback'
import { getOrCreateAnonymousUserId } from '@game-agent/anonymous-user-id'
import { unsupportedModel, unsupportedInbox } from '@game-agent/agent-loop-testkit'
import { brandString } from '@game-agent/brand'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

/** Register one idle agent over a store-owned session, as an app's spine does. */
async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = brandString<SessionId>('feedback-loader-agent')
  const session = ctx.sessions.create(id)
  let status: AgentStatus = 'idle'
  const value: Agent = {
    id,
    options: {},
    session,
    model: unsupportedModel(),
    inbox: unsupportedInbox(),
    ctx: scope.ctx,
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

describe('/feedback real Loader composition through game-agent.yml', () => {
  it('boots game-agent.yml and records feedback without model-visible output', async () => {
    root = await mkdtemp(join(tmpdir(), 'game-agent-command-feedback-loader-'))
    vi.stubEnv('GAME_AGENT_HOME', root)
    const configPath = join(root, 'game-agent.yml')
    await writeFile(configPath, [
      "- name: '@game-agent/session-projection'",
      "- name: '@game-agent/agent'",
      "- name: '@game-agent/session-projection'",
      "- name: '@game-agent/session'",
      "- name: '@game-agent/commands'",
      "- name: '@game-agent/command-feedback'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@game-agent/session-projection', SessionProjectionRegistry],
      ['@game-agent/agent', AgentRegistry],
      ['@game-agent/session-projection', SessionProjectionRegistry],
      ['@game-agent/session', SessionStore],
      ['@game-agent/commands', CommandRuntime],
      ['@game-agent/command-feedback', CommandFeedback],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'kernel:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = await agent(context)
    const signal = new AbortController().signal

    // Discoverable through the composed registry, as a UI adapter finds it.
    expect(context.commands.list(owner).map(command => command.name)).toContain('feedback')

    const accepted = await context.commands.execute(owner, '/feedback the diff view is unreadable', [], signal)
    const userId = getOrCreateAnonymousUserId({ env: { GAME_AGENT_HOME: root } })
    expect(accepted?.result).toEqual({
      kind: 'success',
      text: `Feedback recorded for session feedback-loader-agent\nAnonymous user: ${userId}.`,
    })
    const rejected = await context.commands.execute(owner, '/feedback', [], signal)
    expect(rejected?.result).toEqual({
      kind: 'error',
      text: 'Feedback text is required. Usage: /feedback <text>',
    })

    // The domain event owns the payload; generic command bookkeeping omits it.
    expect(owner.session.snapshotEvents().map(event => event.type))
      .toEqual(['command/run', 'feedback/record', 'command/done', 'command/run', 'command/done'])
    const run = owner.session.snapshotEvents().find(event => event.type === 'command/run')
    expect(run?.type === 'command/run' && Object.hasOwn(run.data, 'args')).toBe(false)
    const feedback = owner.session.snapshotEvents().find(event => event.type === 'feedback/record')
    expect(feedback?.type === 'feedback/record' && feedback.data.text).toBe('the diff view is unreadable')
    expect(JSON.stringify(owner.session.snapshotEvents()).match(/the diff view is unreadable/gu)).toHaveLength(1)

    // Nothing reached the model.
    expect(owner.session.deriveMessages()).toEqual([])
    expect(owner.session.surface.nodes).toEqual([])
  })
})
