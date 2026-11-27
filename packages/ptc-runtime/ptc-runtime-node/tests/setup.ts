import { Context } from '@game-agent/kernel'
import { onTestFinished } from 'vitest'
import SessionStore from '@game-agent/session'
import FileSystem from '@game-agent/fs-local'
import Subprocess from '@game-agent/subprocess-local'
import Sandbox from '@game-agent/sandbox-local'
import SandboxPolicy from '@game-agent/sandbox-policy'
import SessionProjections from '@game-agent/session-projection'
import type { SandboxMode } from '@game-agent/sandbox'
import NodeRuntime from '../src/index.ts'
import type { Config } from '../src/index.ts'

type Policy = { mode?: SandboxMode; workspaceRoot?: string }

/** Mount the provider with its exact configuration, without the per-call default that `mountRuntime` adds. */
export async function mountConfiguredRuntime(ctx: Context, config: Config, policy: Policy = {}) {
  onTestFinished(async () => { await ctx.fiber.dispose() })
  if (!ctx.get('sessions')) await ctx.plugin(SessionStore)
  if (!ctx.get('fs')) await ctx.plugin(FileSystem)
  if (!ctx.get('subprocess')) await ctx.plugin(Subprocess)
  if (!ctx.get('sandbox')) await ctx.plugin(Sandbox, {})
  if (!ctx.get('sessionProjections')) await ctx.plugin(SessionProjections)
  if (!ctx.get('sandboxPolicy')) await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  const fiber = await ctx.plugin(NodeRuntime, config)
  return { runtime: ctx.ptcRuntime as NodeRuntime, fiber }
}

/** Mount the provider; suites exercise function bodies unless the configuration names an execution mode. */
export async function mountRuntime(ctx: Context, config: Config = {}, policy: Policy = {}) {
  return mountConfiguredRuntime(ctx, { executionMode: 'per-call', ...config }, policy)
}
