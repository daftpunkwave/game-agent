/**
 * Responsibilities: Enforce the source file header and the zero-leftover rule on hand-written TypeScript.
 * Contracts: Every scanned file starts (after an optional shebang) with a TSDoc block that contains the required fields Responsibilities, Contracts, and Constraints, each with text; the block may hold any other text as well. Source files contain no debug statements or leftover task markers.
 * Constraints: Scans `.ts`, `.tsx`, `.mts`, and `.cts` files (not declaration files) in packages, apps, scripts, and root config files; prints every violation and exits with code 1 when any exists.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** Fields every file header must contain. Their order is free, and the header may hold other text. */
const REQUIRED_FIELDS = ['Responsibilities', 'Contracts', 'Constraints'] as const
const FIELD_LINE = new RegExp(`^(${REQUIRED_FIELDS.join('|')}):(.*)$`)
const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/
const DECLARATION_FILE = /\.d\.(ts|mts|cts)$/
/** Packages whose files carry no file header; every export is documented with TSDoc instead. */
const HEADER_EXEMPT_PREFIXES = ['packages/kernel/']
/**
 * Packages whose source files open with a TSDoc module comment instead of a header with the required fields.
 * Their test files carry no header.
 */
const TSDOC_HEADER_PREFIXES = [
  'packages/util/atomic-write/',
  'packages/util/brand/',
  'packages/util/chunked-list/',
  'packages/util/code-language/',
  'packages/util/crypto/',
  'packages/util/deque/',
  'packages/util/error/',
  'packages/util/file-drag/',
  'packages/util/home-paths/',
  'packages/util/http-proxy/',
  'packages/util/launch-environment/',
  'packages/util/lazy-require/',
  'packages/util/output-retention/',
  'packages/util/package-manifest/',
  'packages/util/text-search/',
  'packages/util/time/',
  'packages/util/timeout/',
  'packages/util/values/',
  'packages/util/workspace-path/',
]
/** Files whose purpose is console output, exempt from the console.log leftover rule. */
const CONSOLE_OUTPUT_FILES = new Set(['packages/kernel/logger-console/src/shared.ts'])
const LEFTOVER_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'console.log', pattern: /\bconsole\.log\(/ },
  { label: 'debugger', pattern: /^\s*debugger;?\s*$/m },
  { label: 'TODO/FIXME marker', pattern: /\/\/\s*(TODO|FIXME)\b|\*\s*(TODO|FIXME)\b/ },
]

async function collect(path: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const full = join(path, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') result.push(...(await collect(full)))
    else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !DECLARATION_FILE.test(entry.name)) result.push(full)
  }
  return result
}

/**
 * Describe what is wrong with a file header's required fields.
 * A field counts when a comment line starts with `<Field>:` and text follows, either on that line or on the
 * lines before the next required field. Text before the first required field is free-form, and tag lines
 * such as `@module` never count as field text.
 * @param header - the opening TSDoc block, or an empty string when the file has none.
 * @returns one problem per missing or empty field, or an empty list when the header is complete.
 */
function headerProblems(header: string): string[] {
  const content = new Map<string, string>()
  let current: string | undefined
  for (const raw of header.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n')) {
    const line = raw.replace(/^\s*\*?\s?/, '').trimEnd()
    const field = FIELD_LINE.exec(line)
    if (field?.[1] !== undefined) {
      current = field[1]
      content.set(current, `${content.get(current) ?? ''}${field[2] ?? ''}`.trim())
    } else if (current !== undefined && !line.startsWith('@')) {
      content.set(current, `${content.get(current) ?? ''} ${line}`.trim())
    }
  }
  const problems: string[] = []
  for (const field of REQUIRED_FIELDS) {
    const text = content.get(field)
    if (text === undefined) problems.push(`is missing ${field}`)
    else if (text === '') problems.push(`has an empty ${field}`)
  }
  return problems
}

async function main(): Promise<number> {
  const root = process.cwd()
  const files = [
    ...(await collect(join(root, 'packages'))),
    ...(await collect(join(root, 'apps'))),
    ...(await collect(join(root, 'scripts'))),
    join(root, 'vitest.config.ts'),
  ]
  const violations: string[] = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const where = relative(root, file).replaceAll('\\', '/')
    const body = text.startsWith('#!') ? text.slice(text.indexOf('\n') + 1) : text
    const header = body.startsWith('/**') ? body.slice(0, body.indexOf('*/') + 2) : ''
    if (TSDOC_HEADER_PREFIXES.some((prefix) => where.startsWith(prefix))) {
      if (where.includes('/src/') && header === '') violations.push(`${where}: source file does not open with a TSDoc comment`)
    } else if (!HEADER_EXEMPT_PREFIXES.some((prefix) => where.startsWith(prefix))) {
      for (const problem of headerProblems(header)) violations.push(`${where}: file header ${problem}`)
    }
    if (where.startsWith('scripts/')) continue
    for (const leftover of LEFTOVER_PATTERNS) {
      if (leftover.label === 'console.log' && CONSOLE_OUTPUT_FILES.has(where)) continue
      if (leftover.pattern.test(text)) violations.push(`${where}: contains ${leftover.label}`)
    }
  }
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  process.stdout.write(`check:headers scanned ${files.length} files, ${violations.length} violation(s)\n`)
  return violations.length === 0 ? 0 : 1
}

process.exitCode = await main()
