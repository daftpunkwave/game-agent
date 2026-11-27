/**
 * Real-load-path guard for @game-agent/tool-fs-search. `tool-fs-search` is
 * a NAMESPACE plugin with `inject` — so a stray `export default apply` would
 * make the kernel Loader's `unwrapExports` (`exports.default ?? exports`)
 * collapse the module to the bare `apply` function, DROPPING `inject`. The
 * plugin would then read `ctx.subprocess` without having injected it and throw
 * `cannot get property … without inject` the moment it loads (postmortem 0001).
 *
 * A hand-built `ctx.plugin({ apply, inject })` mount CANNOT catch that — it
 * bypasses `unwrapExports`. So this test unwraps the module through the REAL
 * `Loader.prototype.unwrapExports` and mounts the result over the real local
 * subprocess service, exercising the exact path the Loader uses. Prove the
 * guard bites: add `export default apply` to `src/index.ts`, watch this go
 * red, revert.
 */

import SessionProjectionRegistry from '@game-agent/session-projection'
import * as NativeToolExecutor from '@game-agent/tool-executor-native'
import { provideWorkingDirectoryFixture } from '@game-agent/agent-loop-testkit'
import { describe, expect, it } from 'vitest'
import { Context } from '@game-agent/kernel'
import Loader from '@game-agent/kernel-loader'
import SystemPrompt from '@game-agent/system-prompt'
import ToolRuntime from '@game-agent/tools'
import LocalSubprocessRuntime from '@game-agent/subprocess-local'
import * as toolFsSearch from '@game-agent/tool-fs-search'

describe('game-agent-tool-fs-search real-load-path guard', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in toolFsSearch).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolFsSearch) as Record<string, unknown>
    expect(unwrapped).toBe(toolFsSearch)
    expect(unwrapped.name).toBe('tool-fs-search')
    expect(unwrapped.inject).toEqual(['tools', 'systemPrompt', 'subprocess', 'workingDirectory'])
    expect(typeof unwrapped.Config).toBe('function')
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('boots over ctx.subprocess through the unwrapped module without an inject error', async () => {
    const ctx = new Context()
    provideWorkingDirectoryFixture(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(LocalSubprocessRuntime)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(toolFsSearch) as Parameters<Context['plugin']>[0]
    // A collapsed export shape (dropped inject) would throw "without inject" here.
    const fiber = await ctx.plugin(unwrapped, { sampleOverCapGlobResults: true })
    expect(ctx.tools.schemas().map(s => s.name)).toEqual(expect.arrayContaining(['glob', 'grep']))
    await fiber.dispose()
  })
})
