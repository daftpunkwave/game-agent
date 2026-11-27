import { Context } from '@game-agent/kernel'
import WorkingDirectory from '@game-agent/working-directory'
import type { Agent } from '@game-agent/agent'
import AgentLoop from '@game-agent/agent-loop'
import { mountAgentLoopTestDependencies } from '@game-agent/agent-loop-testkit'
import LocalFileSystem from '@game-agent/fs-local'
import * as FsPolicy from '@game-agent/fs-observation-policy'
import * as ToolFs from '@game-agent/tool-fs'
import * as LlmMessages from '@game-agent/llm-messages-api-key'
import MessagesAuth from '@game-agent/messages-auth'

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
export async function fsRig(fsCwd: string, persona = ''): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessagesAuth)
  await ctx.plugin(LlmMessages)
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
