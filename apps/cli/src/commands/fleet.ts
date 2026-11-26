/**
 * Responsibilities: `game-agent fleet ...`: operator commands over a fleet file (list, create, release, pause, resume, takeover, handback, spending, publish, rollout).
 * Contracts: Every mutating command saves the file atomically and is recorded in the fleet audit log with the operator name.
 * Constraints: Operates on the fleet file only; running agents pick up changes through their host, not through this command.
 */
import { userInfo } from 'node:os'
import { parseArgs } from 'node:util'
import { Fleet, loadFleetDocument, saveFleetDocument, type AgentLifecycle, type AgentProfile, type RiskAppetite } from '@game-agent/fleet'
import { systemClock, systemIds } from '@game-agent/ports'
import { CliError, listOption, numberOption, readJsonFile, requireOption, type Output } from '../io.ts'

const USAGE = 'usage: game-agent fleet list|create|release|pause|resume|takeover|handback|spending|publish|rollout --file <fleet.json> [options]'
const RISKS: readonly RiskAppetite[] = ['aggressive', 'balanced', 'conservative']

function parseWindows(value: string | undefined): { start: string; end: string }[] {
  const windows = listOption(value ?? '08:00-23:00').map((item) => {
    const [start, end] = item.split('-')
    if (start === undefined || end === undefined || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw new CliError(`--active window "${item}" must look like 08:00-12:00`)
    return { start, end }
  })
  if (windows.length === 0) throw new CliError('--active needs at least one window')
  return windows
}

function parseTemplate(value: string): { templateId: string; version: number } {
  const [templateId, version] = value.split('@')
  const parsed = Number(version)
  if (templateId === undefined || templateId === '' || !Number.isInteger(parsed) || parsed < 1) throw new CliError('--template must look like <id>@<version>')
  return { templateId, version: parsed }
}

function describe(agent: AgentProfile): string {
  return `${agent.agentId}  ${agent.displayName}  ${agent.realm.region}/${agent.realm.server}  ${agent.status}  tree ${agent.tree.templateId}@${agent.tree.version}  ${agent.persona.risk}  ${agent.spending.currency} ${agent.spending.dailyLimit}/day`
}

/** Run a `fleet` subcommand. */
export async function fleetCommand(argv: readonly string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      operator: { type: 'string' },
      json: { type: 'boolean' },
      region: { type: 'string' },
      server: { type: 'string' },
      status: { type: 'string' },
      agents: { type: 'string' },
      agent: { type: 'string' },
      template: { type: 'string' },
      count: { type: 'string' },
      'name-prefix': { type: 'string' },
      account: { type: 'string' },
      risk: { type: 'string' },
      language: { type: 'string' },
      'messages-per-day': { type: 'string' },
      'utc-offset': { type: 'string' },
      active: { type: 'string' },
      currency: { type: 'string' },
      'daily-limit': { type: 'string' },
      'total-limit': { type: 'string' },
      tree: { type: 'string' },
      'target-version': { type: 'string' },
      percent: { type: 'string' },
      pinned: { type: 'boolean' },
    },
  })
  const [action] = positionals
  const path = requireOption(values.file, 'file')
  const operator = values.operator ?? userInfo().username
  const fleet = new Fleet(await loadFleetDocument(path), systemClock, systemIds)
  const save = async (): Promise<void> => saveFleetDocument(path, fleet.document)

  switch (action) {
    case 'list': {
      const agents = fleet.list({
        ...(values.region === undefined ? {} : { region: values.region }),
        ...(values.server === undefined ? {} : { server: values.server }),
        ...(values.status === undefined ? {} : { status: values.status as AgentLifecycle }),
      })
      if (values.json === true) out.json(agents)
      else if (agents.length === 0) out.line('no agents')
      else for (const agent of agents) out.line(describe(agent))
      return 0
    }
    case 'create': {
      const risk = (values.risk ?? 'balanced') as RiskAppetite
      if (!RISKS.includes(risk)) throw new CliError(`--risk must be one of ${RISKS.join(', ')}`)
      const created = fleet.create(
        {
          namePrefix: values['name-prefix'] ?? 'agent',
          realm: { region: requireOption(values.region, 'region'), server: requireOption(values.server, 'server') },
          account: requireOption(values.account, 'account'),
          tree: parseTemplate(requireOption(values.template, 'template')),
          persona: { risk, language: values.language ?? 'en', messagesPerDay: numberOption(values['messages-per-day'], 'messages-per-day', 12) },
          schedule: { utcOffsetMinutes: Math.round(Number(values['utc-offset'] ?? '0')), windows: parseWindows(values.active) },
          spending: { currency: values.currency ?? 'premium', dailyLimit: numberOption(values['daily-limit'], 'daily-limit', 0), totalLimit: numberOption(values['total-limit'], 'total-limit', 0) },
        },
        numberOption(values.count, 'count', 1),
        operator,
      )
      await save()
      for (const agent of created) out.line(`created ${describe(agent)}`)
      return 0
    }
    case 'release':
    case 'pause':
    case 'resume': {
      const agentIds = listOption(requireOption(values.agents, 'agents'))
      const changed = action === 'release' ? fleet.release(agentIds, operator) : fleet.setActive(agentIds, action === 'resume', operator)
      await save()
      for (const agent of changed) out.line(`${action} ${describe(agent)}`)
      return 0
    }
    case 'takeover':
    case 'handback': {
      const agentId = requireOption(values.agent, 'agent')
      const agent = action === 'takeover' ? fleet.beginTakeover(agentId, operator) : fleet.endTakeover(agentId, operator)
      await save()
      out.line(`${action} ${describe(agent)}`)
      return 0
    }
    case 'spending': {
      const limits = {
        ...(values['daily-limit'] === undefined ? {} : { dailyLimit: numberOption(values['daily-limit'], 'daily-limit', 0) }),
        ...(values['total-limit'] === undefined ? {} : { totalLimit: numberOption(values['total-limit'], 'total-limit', 0) }),
      }
      const changed = fleet.adjustSpending(listOption(requireOption(values.agents, 'agents')), limits, operator)
      await save()
      for (const agent of changed) out.line(`spending ${describe(agent)}`)
      return 0
    }
    case 'publish': {
      const record = fleet.publishTemplate(await readJsonFile(requireOption(values.tree, 'tree')), operator)
      await save()
      out.line(`published ${record.templateId}@${record.version}`)
      return 0
    }
    case 'rollout': {
      const templateId = requireOption(values.template, 'template')
      if (values.pinned === true) fleet.setRollout(templateId, { kind: 'pinned' }, operator)
      else {
        fleet.setRollout(
          templateId,
          { kind: 'staged', targetVersion: numberOption(requireOption(values['target-version'], 'target-version'), 'target-version', 0), percent: numberOption(requireOption(values.percent, 'percent'), 'percent', 0) },
          operator,
        )
      }
      await save()
      const moved = fleet.list().filter((agent) => agent.tree.templateId === templateId && fleet.effectiveTreeVersion(agent) !== agent.tree.version)
      out.line(`rollout for ${templateId} saved; ${moved.length} agent(s) move to a newer version`)
      return 0
    }
    default:
      throw new CliError(USAGE)
  }
}
