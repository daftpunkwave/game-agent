/**
 * Responsibilities: `game-agent run --config <file>`: run one agent against a real game over MCP with an OpenAI-compatible model, hosted by the kernel app layer.
 * Contracts: The config file names the tree, visibility policy, MCP endpoint, model endpoint, and the environment variable holding the API key; trace lines stream to stdout and optionally to a JSON Lines file.
 * Constraints: The API key is read from the environment only and never printed. Stops cleanly on SIGINT or SIGTERM.
 */
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { GameAgentHost, createAppContext } from '@game-agent/app'
import { validateTreeDefinition } from '@game-agent/behavior-tree'
import { isJsonObject, type JsonValue } from '@game-agent/contracts'
import { DecisionEngine } from '@game-agent/decision'
import type { VisibilityPolicy } from '@game-agent/gateway'
import { OpenAiCompatibleModelAdapter } from '@game-agent/model-openai-compatible'
import { systemClock, systemIds, systemRng } from '@game-agent/ports'
import { FanOutTraceSink, JsonlTraceSink, type TraceRecord, type TraceSink } from '@game-agent/trace'
import { McpTransportAdapter } from '@game-agent/transport-mcp'
import { CliError, readJsonFile, requireOption, type Output } from '../io.ts'

interface RunConfig {
  agentId: string
  tree: string
  visibility: string
  game: { url: string; snapshotTool: string; eventsTool?: string; statusTool?: string; callTimeoutMs?: number; canPauseGameTime?: boolean }
  model?: { baseUrl: string; model: string; apiKeyEnv: string }
  gameRules?: string
  persona?: string
  quota?: { dailyTotal?: number; dailyPerAction?: Record<string, number> }
  jitter?: { minMs: number; maxMs: number }
  trace?: string
}

function field<T>(source: Record<string, JsonValue>, key: string, check: (value: JsonValue | undefined) => boolean, message: string): T {
  const value = source[key]
  if (!check(value)) throw new CliError(`config: ${message}`)
  return value as T
}

function parseRunConfig(raw: unknown): RunConfig {
  if (!isJsonObject(raw as JsonValue)) throw new CliError('config must be a JSON object')
  const source = raw as Record<string, JsonValue>
  const isString = (value: JsonValue | undefined): boolean => typeof value === 'string' && value !== ''
  const game = field<Record<string, JsonValue>>(source, 'game', (value) => isJsonObject(value as JsonValue), '"game" must be an object')
  field(game, 'url', isString, '"game.url" is required')
  field(game, 'snapshotTool', isString, '"game.snapshotTool" is required')
  return {
    ...(source as unknown as RunConfig),
    agentId: field(source, 'agentId', isString, '"agentId" is required'),
    tree: field(source, 'tree', isString, '"tree" is required'),
    visibility: field(source, 'visibility', isString, '"visibility" is required'),
  }
}

function formatRecord(record: TraceRecord): string {
  return `${new Date(record.at).toISOString()}  ${record.agentId}  ${record.category.padEnd(10)} ${record.name}  ${JSON.stringify(record.detail)}`
}

/** Run the `run` command until interrupted. */
export async function runCommand(argv: readonly string[], out: Output): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { config: { type: 'string' } } })
  const configPath = resolve(requireOption(values.config, 'config'))
  const base = dirname(configPath)
  const config = parseRunConfig(await readJsonFile(configPath))

  const treeValidation = validateTreeDefinition(await readJsonFile(resolve(base, config.tree)))
  if (!treeValidation.ok) throw new CliError(`tree ${config.tree} is invalid; run "game-agent tree validate"`)
  const visibility = (await readJsonFile(resolve(base, config.visibility))) as VisibilityPolicy

  let decision: DecisionEngine | undefined
  if (config.model !== undefined) {
    const apiKey = process.env[config.model.apiKeyEnv]
    if (apiKey === undefined || apiKey === '') throw new CliError(`environment variable ${config.model.apiKeyEnv} is not set`)
    decision = new DecisionEngine({
      model: new OpenAiCompatibleModelAdapter({ baseUrl: config.model.baseUrl, model: config.model.model, apiKey }),
      gameRules: config.gameRules ?? '',
    })
  }

  const console: TraceSink = { write: (record) => out.line(formatRecord(record)) }
  const file = config.trace === undefined ? undefined : new JsonlTraceSink(resolve(base, config.trace))
  const trace = file === undefined ? console : new FanOutTraceSink([console, file])
  const transport = new McpTransportAdapter({
    connection: { kind: 'streamable-http', url: config.game.url },
    agentId: config.agentId,
    snapshotTool: config.game.snapshotTool,
    ...(config.game.eventsTool === undefined ? {} : { eventsTool: config.game.eventsTool }),
    ...(config.game.statusTool === undefined ? {} : { statusTool: config.game.statusTool }),
    callTimeoutMs: config.game.callTimeoutMs ?? 120_000,
    canPauseGameTime: config.game.canPauseGameTime ?? false,
  })

  const ctx = createAppContext()
  const fiber = await ctx.plugin(GameAgentHost, { clock: systemClock, heartbeatMs: 30_000 })
  await ctx.gameAgents.spawn({
    agentId: config.agentId,
    transport,
    tree: treeValidation.tree,
    visibility,
    quota: config.quota ?? { dailyTotal: 1_000 },
    jitter: config.jitter ?? { minMs: 300, maxMs: 2_500 },
    clock: systemClock,
    rng: systemRng,
    ids: systemIds,
    delay: (milliseconds, signal) =>
      new Promise((resolveDelay, reject) => {
        const timer = setTimeout(resolveDelay, milliseconds)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(signal.reason)
        })
      }),
    trace,
    ...(decision === undefined ? {} : { decision }),
    ...(config.persona === undefined ? {} : { persona: config.persona }),
  })
  out.line(`agent ${config.agentId} is running; press Ctrl+C to stop`)

  await new Promise<void>((resolveStop) => {
    process.once('SIGINT', () => resolveStop())
    process.once('SIGTERM', () => resolveStop())
  })
  await fiber.dispose()
  await ctx.gameAgents?.stopAll()
  await file?.flush()
  return 0
}
