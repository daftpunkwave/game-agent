/**
 * Responsibilities: Register the `game_agent` tool in DSH sessions so the conversation model can inspect agents and validate or outline behavior trees.
 * Contracts: Actions are `help`, `status`, `validate_tree`, and `outline_tree`; results are plain text so any model can read them.
 * Constraints: Read-only with respect to the game; commands to the game go through the runtime's egress gateway, never through this tool.
 */
import type { Context } from '@deepseek-ai/cordis'
import { listNodes, validateTreeDefinition } from '@game-agent/behavior-tree'

/** Tool shape accepted by the DSH tool registry. */
export interface ConsoleToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, { type: string; required?: boolean; description: string; additionalProperties?: boolean }>
  execute(args: { action?: unknown; tree?: unknown }): Promise<string>
}

interface StatusSource {
  list(): { agentId: string; treeId: string; treeVersion: number; openIntents: number; decisions: number }[]
}

const HELP = [
  'game_agent actions:',
  '- status: list agents hosted in this process with their tree version, open intents, and decision count.',
  '- validate_tree: check a behavior tree JSON passed in "tree"; reports every problem with its node path.',
  '- outline_tree: print the node outline of a valid tree passed in "tree".',
].join('\n')

/** Build the tool; `statusSource` returns the hosted agents when a host runs in this process. */
export function createConsoleTool(statusSource: () => StatusSource | undefined): ConsoleToolDefinition {
  return {
    name: 'game_agent',
    description: 'Inspect game-agent runtimes and check behavior trees. Call with action="help" first.',
    parameters: {
      action: { type: 'string', required: true, description: 'help, status, validate_tree, or outline_tree' },
      tree: { type: 'object', additionalProperties: true, description: 'Behavior tree JSON for validate_tree and outline_tree' },
    },
    async execute(args) {
      switch (args.action) {
        case 'status': {
          const agents = statusSource()?.list()
          if (agents === undefined) return 'No game-agent host runs in this process.'
          if (agents.length === 0) return 'No agents are running.'
          return agents.map((agent) => `${agent.agentId}: tree ${agent.treeId}@${agent.treeVersion}, open intents ${agent.openIntents}, decisions ${agent.decisions}`).join('\n')
        }
        case 'validate_tree': {
          const result = validateTreeDefinition(args.tree)
          return result.ok ? `Valid tree ${result.tree.id}@${result.tree.version}.` : result.problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n')
        }
        case 'outline_tree': {
          const result = validateTreeDefinition(args.tree)
          if (!result.ok) return 'The tree is invalid; run validate_tree first.'
          return listNodes(result.tree)
            .map(({ path, depth, node }) => `${'  '.repeat(depth)}${node.type}${node.name === undefined ? '' : ` "${node.name}"`} (${path})`)
            .join('\n')
        }
        default:
          return HELP
      }
    },
  }
}

/** Register the tool with DSH's tool registry when it exists. */
export function registerConsoleTool(ctx: Context, log: (level: 'info' | 'warn', message: string) => void): void {
  ctx.effect(() => {
    const tools = ctx.get('tools') as { register(tool: ConsoleToolDefinition): (() => void) | { dispose(): void } | undefined } | undefined
    if (tools === undefined) {
      log('warn', 'this DSH build has no tool registry; game_agent tool not added')
      return () => {}
    }
    const registration = tools.register(createConsoleTool(() => ctx.get('gameAgents') as StatusSource | undefined))
    return () => {
      if (typeof registration === 'function') registration()
      else registration?.dispose()
    }
  })
}
