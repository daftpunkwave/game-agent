/**
 * Responsibilities: Verify action listing, receipt mapping, snapshots, status queries, and pull-based events of the MCP adapter.
 * Contracts: Uses an in-test `McpSession` double; the real SDK is never contacted.
 * Constraints: Deterministic clock injected through configuration.
 */
import { describe, expect, it } from 'vitest'
import type { JsonObject, RawGameEvent } from '@game-agent/contracts'
import { ManualClock } from '@game-agent/ports'
import { McpTransportAdapter, type McpSession, type McpToolResult } from '../src/index.ts'

function fakeSession(handlers: Record<string, (args: JsonObject) => McpToolResult>): McpSession & { calls: { name: string; args: JsonObject }[] } {
  const calls: { name: string; args: JsonObject }[] = []
  return {
    calls,
    async listTools() {
      return Object.keys(handlers).map((name) => ({ name, description: `${name} tool`, inputSchema: { type: 'object' as const } }))
    },
    async callTool(name, args) {
      calls.push({ name, args })
      const handler = handlers[name]
      if (handler === undefined) return { isError: true, text: `no tool ${name}` }
      return handler(args)
    },
    async close() {},
  }
}

const intent = (action: string) => ({ intentId: 'i1', agentId: 'farmer', action, args: {}, source: 'tree' as const, issuedAt: 0, idempotencyKey: 'farmer:i1' })

async function adapterFor(session: McpSession) {
  const adapter = new McpTransportAdapter(
    {
      connection: { kind: 'streamable-http', url: 'http://127.0.0.1:18080/mcp' },
      agentId: 'farmer',
      snapshotTool: 'get_state',
      eventsTool: 'poll_events',
      statusTool: 'command_status',
      resourceConsumingTools: ['buy'],
      callTimeoutMs: 1000,
      clock: new ManualClock(42),
    },
    async () => session,
  )
  await adapter.connect()
  return adapter
}

describe('McpTransportAdapter', () => {
  it('exposes game tools as actions and hides reserved tools', async () => {
    const adapter = await adapterFor(fakeSession({ get_state: () => ({ isError: false, text: '' }), poll_events: () => ({ isError: false, text: '' }), command_status: () => ({ isError: false, text: '' }), water: () => ({ isError: false, text: 'ok' }), buy: () => ({ isError: false, text: 'ok' }) }))
    const actions = await adapter.listActions()
    expect(actions.map((action) => `${action.name}:${action.consumesResources}`)).toEqual(['water:false', 'buy:true'])
  })

  it('maps structured receipts, plain text, and tool errors', async () => {
    const adapter = await adapterFor(
      fakeSession({
        march: () => ({ isError: false, text: 'queued', structured: { receipt: 'accepted', correlationId: 'm-9', expectedSettleAt: 5000 } }),
        water: () => ({ isError: false, text: 'Watered 12 crops' }),
        buy: () => ({ isError: true, text: 'Not enough gold' }),
      }),
    )
    expect(await adapter.send(intent('march'))).toEqual({ kind: 'accepted', correlationId: 'm-9', expectedSettleAt: 5000 })
    expect(await adapter.send(intent('water'))).toEqual({ kind: 'completed', outcome: 'Watered 12 crops' })
    expect(await adapter.send(intent('buy'))).toEqual({ kind: 'rejected', reason: 'Not enough gold' })
  })

  it('reads snapshot views and command status', async () => {
    const adapter = await adapterFor(
      fakeSession({
        get_state: () => ({ isError: false, text: '', structured: { farm: { crops: 12 }, note: 'ignored' } }),
        command_status: (args) => ({ isError: false, text: '', structured: args['correlationId'] === 'm-1' ? { status: 'succeeded', outcome: { ok: true } } : { status: 'pending' } }),
      }),
    )
    expect(await adapter.snapshot('farmer')).toEqual({ agentId: 'farmer', takenAt: 42, views: { farm: { crops: 12 } } })
    expect(await adapter.queryCommand('m-1')).toEqual({ kind: 'succeeded', outcome: { ok: true } })
    expect(await adapter.queryCommand('m-2')).toEqual({ kind: 'pending' })
  })

  it('polls events with a cursor and forwards them to subscribers', async () => {
    const session = fakeSession({
      poll_events: (args) =>
        args['cursor'] === null
          ? { isError: false, text: '', structured: { cursor: 7, events: [{ eventId: 'e1', type: 'attacked', fields: { by: 'p2' } }, { bad: true }] } }
          : { isError: false, text: '', structured: { cursor: 7, events: [] } },
    })
    const adapter = await adapterFor(session)
    const received: RawGameEvent[] = []
    adapter.subscribe((event) => received.push(event))
    await adapter.poll()
    await adapter.poll()
    expect(received).toEqual([{ eventId: 'e1', agentId: 'farmer', type: 'attacked', occurredAt: 42, fields: { by: 'p2' } }])
    expect(session.calls.map((call) => call.args)).toEqual([{ cursor: null }, { cursor: 7 }])
  })
})
