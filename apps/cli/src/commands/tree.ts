/**
 * Responsibilities: `game-agent tree validate|outline`: check behavior tree files and print their node outline.
 * Contracts: `validate` returns exit code 1 when any file is invalid and lists every problem with its node path.
 * Constraints: Read-only; never modifies tree files.
 */
import { parseArgs } from 'node:util'
import { listNodes, validateTreeDefinition } from '@game-agent/behavior-tree'
import { CliError, readJsonFile, type Output } from '../io.ts'

/** Run a `tree` subcommand. */
export async function treeCommand(argv: readonly string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: {} })
  const [action, ...files] = positionals
  if (files.length === 0) throw new CliError('usage: game-agent tree validate|outline <file...>')
  switch (action) {
    case 'validate': {
      let failures = 0
      for (const file of files) {
        const result = validateTreeDefinition(await readJsonFile(file))
        if (result.ok) {
          out.line(`ok    ${file}  ${result.tree.id}@${result.tree.version}`)
          continue
        }
        failures += 1
        out.line(`error ${file}`)
        for (const problem of result.problems) out.line(`      ${problem.path}: ${problem.message}`)
      }
      return failures === 0 ? 0 : 1
    }
    case 'outline': {
      for (const file of files) {
        const result = validateTreeDefinition(await readJsonFile(file))
        if (!result.ok) throw new CliError(`${file} is not a valid tree; run "game-agent tree validate ${file}"`)
        out.line(`${result.tree.id}@${result.tree.version}${result.tree.title === undefined ? '' : `  ${result.tree.title}`}`)
        for (const { path, depth, node } of listNodes(result.tree)) {
          const label = node.name === undefined ? '' : ` "${node.name}"`
          const detail = node.type === 'action' ? ` ${node.action}` : node.type === 'decision' ? ` [${node.tools.join(', ')}]` : node.type === 'condition' ? ` ${node.check}` : ''
          out.line(`${'  '.repeat(depth + 1)}${node.type}${detail}${label}  (${path})`)
        }
      }
      return 0
    }
    default:
      throw new CliError('usage: game-agent tree validate|outline <file...>')
  }
}
