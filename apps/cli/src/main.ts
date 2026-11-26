#!/usr/bin/env node
/**
 * Responsibilities: Entry point of the `game-agent` command line: dispatch subcommands and map failures to exit codes.
 * Contracts: Exit code 0 on success, 1 on validation failures reported by a command, 2 on usage or runtime errors.
 * Constraints: Subcommands live in `commands/`; this file only routes.
 */
import { fileURLToPath } from 'node:url'
import { GameAgentError } from '@game-agent/errors'
import { fleetCommand } from './commands/fleet.ts'
import { runCommand } from './commands/run.ts'
import { simulateCommand } from './commands/simulate.ts'
import { treeCommand } from './commands/tree.ts'
import { processOutput, type Output } from './io.ts'

const HELP = `game-agent: run language-model agents as headless game clients

Usage:
  game-agent tree validate <file...>        Check behavior tree files
  game-agent tree outline <file...>         Print the node outline of trees
  game-agent simulate --tree <file> [--hours 8] [--step-minutes 1] [--seed 1]
                     [--category intent,decision] [--tag spending] [--trace out.jsonl] [--json]
                                            Run one agent against the simulated game on an accelerated clock
  game-agent fleet <command> --file <fleet.json> [options]
                                            Manage agents: list, create, release, pause, resume,
                                            takeover, handback, spending, publish, rollout
  game-agent run --config <agent.json>      Run one agent against a game over MCP
  game-agent help                           Show this help`

/** Run the CLI with explicit arguments and output; returns the exit code. */
export async function main(argv: readonly string[], out: Output = processOutput): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'tree':
        return await treeCommand(rest, out)
      case 'simulate':
        return await simulateCommand(rest, out)
      case 'fleet':
        return await fleetCommand(rest, out)
      case 'run':
        return await runCommand(rest, out)
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        out.line(HELP)
        return 0
      default:
        out.line(`unknown command "${command}"\n\n${HELP}`)
        return 2
    }
  } catch (error) {
    if (error instanceof GameAgentError) out.line(`error: ${error.message}`)
    else if (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS')) out.line(`error: ${error.message}`)
    else throw error
    return 2
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2))
}
