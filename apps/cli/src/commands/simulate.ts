/**
 * Responsibilities: `game-agent simulate`: run one agent against the simulated game on an accelerated clock and report what it did.
 * Contracts: Deterministic for a given tree, seed, and duration. AI nodes use a scripted placeholder model, so the run validates the rule layer and the plumbing, not model judgment.
 * Constraints: Never contacts a network service; trace output is optional JSON Lines.
 */
import { parseArgs } from 'node:util'
import { AgentRuntime } from '@game-agent/agent-runtime'
import { validateTreeDefinition } from '@game-agent/behavior-tree'
import { DecisionEngine, ScriptedModelAdapter, type ModelRequest, type ModelResponse } from '@game-agent/decision'
import type { VisibilityPolicy } from '@game-agent/gateway'
import { ManualClock, SeededRng, SequentialIds } from '@game-agent/ports'
import { FanOutTraceSink, JsonlTraceSink, MemoryTraceSink, filterTrace, type TraceCategory, type TraceSink } from '@game-agent/trace'
import { SimulatedGameTransport } from '@game-agent/transport-simulated'
import { CliError, listOption, numberOption, readJsonFile, requireOption, type Output } from '../io.ts'

/** Visibility policy matching the simulated game's player-facing screens. */
export const SIMULATED_VISIBILITY: VisibilityPolicy = {
  views: { city: { fields: [{ path: 'food' }, { path: 'wood' }, { path: 'farmLevel' }, { path: 'upgradeCost' }, { path: 'upgrading' }] } },
  events: { 'farm.upgraded': { fields: [{ path: 'farmLevel' }], tags: ['spending'] } },
  budget: { maxStringLength: 200, maxArrayItems: 20, maxFieldsPerView: 20 },
}

const SIMULATION_START = Date.UTC(2026, 0, 1, 0, 0, 0)
const AGENT_ID = 'sim-agent'

/** Placeholder brain: proposes the first offered tool with the first allowed value for each required parameter. */
export function placeholderPolicy(request: ModelRequest): ModelResponse {
  const tool = request.tools[0]
  if (tool === undefined) return { text: 'No tool offered; waiting.', toolCalls: [], malformedCalls: [] }
  const args: Record<string, string | number | boolean> = {}
  for (const name of tool.parameters.required ?? []) {
    const schema = tool.parameters.properties?.[name]
    const first = schema?.enum?.[0]
    if (first !== undefined && first !== null) args[name] = first
    else args[name] = schema?.type === 'number' || schema?.type === 'integer' ? 0 : schema?.type === 'boolean' ? false : 'auto'
  }
  return { text: `Placeholder policy chose ${tool.name}.`, toolCalls: [{ name: tool.name, arguments: args }], malformedCalls: [] }
}

/** Run the `simulate` command. */
export async function simulateCommand(argv: readonly string[], out: Output): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tree: { type: 'string' },
      hours: { type: 'string' },
      'step-minutes': { type: 'string' },
      'upgrade-minutes': { type: 'string' },
      seed: { type: 'string' },
      trace: { type: 'string' },
      category: { type: 'string' },
      tag: { type: 'string' },
      json: { type: 'boolean' },
    },
  })
  const treePath = requireOption(values.tree, 'tree')
  const validation = validateTreeDefinition(await readJsonFile(treePath))
  if (!validation.ok) throw new CliError(`${treePath} is not a valid tree; run "game-agent tree validate ${treePath}"`)
  const hours = numberOption(values.hours, 'hours', 8)
  const stepMs = numberOption(values['step-minutes'], 'step-minutes', 1) * 60_000
  if (stepMs <= 0) throw new CliError('--step-minutes must be greater than zero')

  const clock = new ManualClock(SIMULATION_START)
  const transport = new SimulatedGameTransport({ clock, agents: [AGENT_ID], upgradeDurationMs: numberOption(values['upgrade-minutes'], 'upgrade-minutes', 30) * 60_000 })
  const memory = new MemoryTraceSink(100_000)
  const file = values.trace === undefined ? undefined : new JsonlTraceSink(values.trace)
  const trace: TraceSink = file === undefined ? memory : new FanOutTraceSink([memory, file])
  const model = new ScriptedModelAdapter(placeholderPolicy)
  const runtime = new AgentRuntime({
    agentId: AGENT_ID,
    transport,
    tree: validation.tree,
    visibility: SIMULATED_VISIBILITY,
    quota: { dailyTotal: 500 },
    jitter: { minMs: 0, maxMs: 0 },
    clock,
    rng: new SeededRng(numberOption(values.seed, 'seed', 1)),
    ids: new SequentialIds(),
    delay: async () => {},
    trace,
    decision: new DecisionEngine({ model, gameRules: 'Simulated farm: gather resources and upgrade the farm.', timeoutSignal: () => new AbortController().signal }),
  })

  await runtime.start()
  const end = SIMULATION_START + hours * 3_600_000
  let steps = 0
  while (clock.now() < end) {
    transport.advance()
    await runtime.step()
    await runtime.settle()
    steps += 1
    clock.advance(stepMs)
  }
  await runtime.stop()
  await file?.flush()

  const categories = listOption(values.category) as TraceCategory[]
  const tags = listOption(values.tag)
  const records = filterTrace(memory.records(), {
    ...(categories.length === 0 ? {} : { categories }),
    ...(tags.length === 0 ? {} : { tags }),
  })
  const status = runtime.status()
  const states = new Map<string, number>()
  for (const record of memory.records()) {
    if (record.category === 'intent' || record.category === 'settlement') states.set(record.name, (states.get(record.name) ?? 0) + 1)
  }
  const city = Object.fromEntries([...runtime.blackboard].filter(([key]) => key.startsWith('city.')))
  const summary = { simulatedHours: hours, steps, decisions: status.decisions, openIntents: status.openIntents, counts: Object.fromEntries(states), city }

  if (values.json === true) {
    out.json({ summary, trace: records })
    return 0
  }
  out.line(`simulated ${hours}h in ${steps} steps (${stepMs / 60_000} min per step)`)
  out.line(`decisions: ${status.decisions}   open intents: ${status.openIntents}`)
  out.line(`intent outcomes: ${[...states].map(([name, count]) => `${name}=${count}`).join('  ') || '(none)'}`)
  out.line(`final city: ${JSON.stringify(city)}`)
  if (categories.length > 0 || tags.length > 0) {
    out.line(`--- ${records.length} trace records ---`)
    for (const record of records) {
      const minutes = Math.round((record.at - SIMULATION_START) / 60_000)
      out.line(`+${String(minutes).padStart(4)}m  ${record.category.padEnd(10)} ${record.name}${record.tags.length > 0 ? ` [${record.tags.join(',')}]` : ''}  ${JSON.stringify(record.detail)}`)
    }
  }
  return 0
}
