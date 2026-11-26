/**
 * Responsibilities: Check pull request titles, descriptions, and commit messages against the repository's Conventional Commits and English-only rules.
 * Contracts: Checks PR_TITLE and PR_BODY from the environment when they are set, and every non-merge commit in the revision range given by `--range` (default `origin/main..HEAD`); prints one line per violation and exits with code 1 when any exists.
 * Constraints: Uses only git and Node.js built-ins so it runs without installing dependencies; merge commits are skipped because updating a branch from its base creates them.
 */
import { execFileSync } from 'node:child_process'

const TYPES = ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'style', 'build', 'ci', 'chore', 'revert']
const HEADER = new RegExp(`^(?:${TYPES.join('|')})(?:\\([a-z0-9][a-z0-9-]*\\))?!?: \\S`)
const HEADER_HINT = `expected "<type>(<scope>): <summary>" with a lowercase scope and type one of ${TYPES.join(', ')}`
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const DEFAULT_RANGE = 'origin/main..HEAD'

interface CommitMessage {
  readonly sha: string
  readonly message: string
}

function checkHeader(where: string, header: string, violations: string[]): void {
  if (!HEADER.test(header)) violations.push(`${where}: "${header}" is not a Conventional Commits header; ${HEADER_HINT}`)
}

function checkEnglish(where: string, text: string, violations: string[]): void {
  const match = CJK.exec(text)
  if (match !== null) violations.push(`${where}: contains non-English text ("${match[0]}"); titles, descriptions, and commit messages must be written in English`)
}

function readRange(argv: readonly string[]): string {
  const index = argv.indexOf('--range')
  if (index === -1) return DEFAULT_RANGE
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`--range requires a revision range such as ${DEFAULT_RANGE}`)
  return value
}

function listCommits(range: string): CommitMessage[] {
  const output = execFileSync('git', ['log', '--no-merges', '--format=%H%x00%B%x1e', range], { encoding: 'utf8' })
  return output
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const separator = entry.indexOf('\x00')
      return { sha: entry.slice(0, separator), message: entry.slice(separator + 1).trim() }
    })
}

function report(violation: string): void {
  // GitHub Actions turns `::error::` lines into run annotations; escaping keeps each violation on one command line.
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    const escaped = violation.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
    process.stderr.write(`::error::${escaped}\n`)
    return
  }
  process.stderr.write(`${violation}\n`)
}

function main(): number {
  const violations: string[] = []
  const title = process.env['PR_TITLE']
  if (title !== undefined) {
    checkHeader('pull request title', title.trim(), violations)
    checkEnglish('pull request title', title, violations)
  }
  const body = process.env['PR_BODY']
  if (body !== undefined) checkEnglish('pull request description', body, violations)

  const range = readRange(process.argv.slice(2))
  const commits = listCommits(range)
  for (const commit of commits) {
    const where = `commit ${commit.sha.slice(0, 12)}`
    checkHeader(where, commit.message.split('\n', 1)[0] ?? '', violations)
    checkEnglish(where, commit.message, violations)
  }

  for (const violation of violations) report(violation)
  const checkedTitle = title === undefined ? 'no pull request title' : 'the pull request title'
  process.stdout.write(`check:conventions checked ${checkedTitle} and ${commits.length} commit(s) in ${range}, ${violations.length} violation(s)\n`)
  return violations.length === 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (error) {
  report(`check:conventions could not run: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
