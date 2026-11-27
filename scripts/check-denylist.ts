/**
 * Responsibilities: Fail when tracked files, the pull request title and description, or commit messages contain a term from the configured denylist.
 * Contracts: Reads the denylist from the `DENYLIST` environment variable or the file named by `DENYLIST_FILE`: one case-insensitive regular expression per line, `!path` lines exempt a file or directory, `#` lines are comments. Optional `--range <rev-range>` adds commit messages; `PR_TITLE` and `PR_BODY` are checked when set.
 * Constraints: Never prints denylist entries, only their position in the list; outside CI an unconfigured denylist is skipped, inside CI it is an error; binary files are skipped.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

interface Denylist {
  readonly patterns: readonly RegExp[]
  readonly exemptions: readonly string[]
}

function loadDenylist(): Denylist | undefined {
  const source = process.env['DENYLIST'] ?? (process.env['DENYLIST_FILE'] ? readFileSync(process.env['DENYLIST_FILE'], 'utf8') : undefined)
  if (source === undefined || source.trim() === '') return undefined
  const patterns: RegExp[] = []
  const exemptions: string[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('!')) exemptions.push(line.slice(1).replace(/\/+$/, ''))
    else patterns.push(new RegExp(line, 'i'))
  }
  return { patterns, exemptions }
}

function firstMatch(denylist: Denylist, text: string): number {
  return denylist.patterns.findIndex((pattern) => pattern.test(text))
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function rangeArgument(): string | undefined {
  const index = process.argv.indexOf('--range')
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error('--range requires a revision range')
  return value
}

function main(): number {
  const denylist = loadDenylist()
  if (denylist === undefined) {
    if (process.env['CI']) {
      process.stderr.write('check:denylist: no denylist configured (set DENYLIST or DENYLIST_FILE)\n')
      return 1
    }
    process.stdout.write('check:denylist skipped: no denylist configured (set DENYLIST or DENYLIST_FILE)\n')
    return 0
  }
  const violations: string[] = []
  const files = git(['ls-files', '-co', '--exclude-standard']).split('\n').filter((file) => file !== '')
  for (const file of files) {
    if (denylist.exemptions.some((exempt) => file === exempt || file.startsWith(`${exempt}/`))) continue
    let content: Buffer
    try {
      content = readFileSync(file)
    } catch {
      continue
    }
    if (content.subarray(0, 8000).includes(0)) continue
    const pathEntry = firstMatch(denylist, file)
    if (pathEntry !== -1) violations.push(`${file}: path matches denylist entry #${pathEntry + 1}`)
    content.toString('utf8').split(/\r?\n/).forEach((line, index) => {
      const entry = firstMatch(denylist, line)
      if (entry !== -1) violations.push(`${file}:${index + 1}: matches denylist entry #${entry + 1}`)
    })
  }
  for (const [label, text] of [['pull request title', process.env['PR_TITLE']], ['pull request description', process.env['PR_BODY']]] as const) {
    if (text === undefined) continue
    const entry = firstMatch(denylist, text)
    if (entry !== -1) violations.push(`${label}: matches denylist entry #${entry + 1}`)
  }
  const range = rangeArgument()
  if (range !== undefined) {
    for (const record of git(['log', '--format=%H%x00%B%x1e', range]).split('\x1e')) {
      const [sha, message] = record.trim().split('\0')
      if (sha === undefined || message === undefined) continue
      const entry = firstMatch(denylist, message)
      if (entry !== -1) violations.push(`commit ${sha.slice(0, 12)}: message matches denylist entry #${entry + 1}`)
    }
  }
  const annotate = process.env['GITHUB_ACTIONS'] === 'true'
  for (const violation of violations) process.stderr.write(annotate ? `::error::${violation.replaceAll('%', '%25')}\n` : `${violation}\n`)
  process.stdout.write(`check:denylist scanned ${files.length} files, ${violations.length} violation(s)\n`)
  return violations.length === 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`check:denylist: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
