/**
 * Responsibilities: Verify that the DSH bundle builds a preset from the base preset plus game rows, registers the console tool, and cleans up on unload.
 * Contracts: Runs the plugin in a real Cordis context with in-test stand-ins for DSH's `agentPresets` and `tools` services.
 * Constraints: The stand-ins mirror only the members the bundle uses; no DeepSeek Harness installation is required.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { TREE_FORMAT } from '@game-agent/behavior-tree'
import * as bundle from '../src/index.ts'
import { createConsoleTool, type PluginRow } from '../src/index.ts'

describe('dsh bundle', () => {
  it('registers a preset from the base preset and removes it on unload', async () => {
    const ctx = new Context()
    const registered: { id: string; plugins: PluginRow[] }[] = []
    let removed = 0
    const definitions = new Map([['standard', { config: { plugins: [{ id: 'llm', name: '@deepseek-ai/dsh-llm' }] } }]])
    ctx.provide('agentPresets', {
      definitions: { get: (id: string) => definitions.get(id), has: (id: string) => definitions.has(id) },
      register: async (definition: { id: string; plugins: PluginRow[] }) => {
        registered.push(definition)
        return () => {
          removed += 1
        }
      },
    })
    const tools: string[] = []
    ctx.provide('tools', {
      register: (tool: { name: string }) => {
        tools.push(tool.name)
        return () => {
          tools.splice(tools.indexOf(tool.name), 1)
        }
      },
    })
    const fiber = await ctx.plugin(bundle, { game: { serverName: 'farm', url: 'http://127.0.0.1:18080/mcp', toolTimeoutMs: 960_000 } })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(tools).toEqual(['game_agent'])
    expect(registered.map((item) => item.id)).toEqual(['game-agent'])
    expect(registered[0]?.plugins.map((row) => `${row.id}:${row.name}`)).toEqual([
      'llm:@deepseek-ai/dsh-llm',
      'mcp-farm:@deepseek-ai/dsh-mcp-client',
      'game-agent-console:@game-agent/dsh-bundle',
    ])
    await fiber.dispose()
    expect(removed).toBe(1)
    expect(tools).toEqual([])
  })

  it('validates and outlines trees through the console tool', async () => {
    const tool = createConsoleTool(() => undefined)
    const tree = { format: TREE_FORMAT, id: 'daily', version: 2, root: { type: 'sequence', name: 'morning', children: [{ type: 'condition', check: 'always' }] } }
    expect(await tool.execute({ action: 'validate_tree', tree })).toBe('Valid tree daily@2.')
    expect(await tool.execute({ action: 'outline_tree', tree })).toBe('sequence "morning" (root)\n  condition (root/0)')
    expect(await tool.execute({ action: 'validate_tree', tree: { ...tree, version: 0 } })).toBe('$.version: version must be a positive integer')
    expect(await tool.execute({ action: 'status' })).toBe('No game-agent host runs in this process.')
  })
})
