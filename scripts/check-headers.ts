/**
 * Responsibilities: Enforce the three-part source file header and the zero-leftover rule on hand-written TypeScript.
 * Contracts: Every scanned file starts (after an optional shebang) with a TSDoc block naming Responsibilities, Contracts, and Constraints; source files contain no debug statements or leftover task markers.
 * Constraints: Scans packages, apps, scripts, and root config files; prints every violation and exits with code 1 when any exists.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const REQUIRED_LABELS = ['Responsibilities:', 'Contracts:', 'Constraints:']
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
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) result.push(full)
  }
  return result
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
    const missing = REQUIRED_LABELS.filter((label) => !header.includes(label))
    if (missing.length > 0) violations.push(`${where}: file header is missing ${missing.join(', ')}`)
    if (where.startsWith('scripts/')) continue
    for (const leftover of LEFTOVER_PATTERNS) if (leftover.pattern.test(text)) violations.push(`${where}: contains ${leftover.label}`)
  }
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  process.stdout.write(`check:headers scanned ${files.length} files, ${violations.length} violation(s)\n`)
  return violations.length === 0 ? 0 : 1
}

process.exitCode = await main()
