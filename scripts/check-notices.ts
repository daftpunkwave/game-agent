/**
 * Responsibilities: Keep the runtime dependency table of THIRD_PARTY_NOTICES.md in step with the package manifests and the license allow list.
 * Contracts: Collects third-party `dependencies`, `peerDependencies`, and `optionalDependencies` of every `packages/<group>/<name>` and `apps/<name>` manifest; reads each installed package's `license`; reports a dependency missing from the table, a table row no manifest uses, a wrong license or "Used by" column, and a license outside `allow-licenses` of `.github/dependency-review-config.yml`. Exits with code 1 when any problem exists. With `--write` (`pnpm sync:notices`), first rewrites the table from the manifests and installed licenses; the allow list is still enforced.
 * Constraints: Requires `pnpm install` to have run; reads files only; development dependencies are out of scope because they do not ship with the runtime.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md'
const POLICY_FILE = '.github/dependency-review-config.yml'
const TABLE_HEADING = '## Runtime dependencies'

interface TableRow {
  readonly license: string
  readonly usedBy: readonly string[]
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Read the `allow-licenses` list from the dependency review policy (a flat YAML list of strings). */
async function allowedLicenses(root: string): Promise<Set<string>> {
  const allowed = new Set<string>()
  let inList = false
  for (const line of (await readFile(join(root, POLICY_FILE), 'utf8')).split(/\r?\n/)) {
    if (/^allow-licenses:\s*$/.test(line)) inList = true
    else if (inList && /^\s+-\s+/.test(line)) allowed.add(line.replace(/^\s+-\s+/, '').replace(/['"]/g, '').trim())
    else if (inList && line.trim() !== '' && !line.trimStart().startsWith('#')) inList = false
  }
  return allowed
}

/** Whether an SPDX expression is acceptable: every `AND` operand allowed, or any `OR` alternative allowed. */
function licenseAllowed(expression: string, allowed: ReadonlySet<string>): boolean {
  const plain = expression.replace(/[()]/g, ' ').trim()
  if (plain.includes(' OR ')) return plain.split(' OR ').some((part) => licenseAllowed(part, allowed))
  return plain.split(' AND ').every((part) => allowed.has(part.trim()))
}

async function readTable(root: string): Promise<Map<string, TableRow>> {
  const text = await readFile(join(root, NOTICES_FILE), 'utf8')
  const section = text.slice(text.indexOf(TABLE_HEADING))
  const rows = new Map<string, TableRow>()
  for (const line of section.split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 5 || !cells[1]?.startsWith('`')) continue
    const name = cells[1].replace(/`/g, '')
    const usedBy = (cells[3] ?? '').split(',').map((item) => item.replace(/`/g, '').trim()).filter((item) => item !== '')
    rows.set(name, { license: cells[2] ?? '', usedBy })
  }
  return rows
}

/** Replace the rows of the runtime dependency table, keeping everything else in the file. */
async function writeTable(root: string, users: ReadonlyMap<string, readonly string[]>, licenses: ReadonlyMap<string, string>): Promise<void> {
  const path = join(root, NOTICES_FILE)
  const lines = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').split('\n')
  const heading = lines.findIndex((line) => line.startsWith(TABLE_HEADING))
  const separator = lines.findIndex((line, index) => index > heading && line.startsWith('|---'))
  let end = separator + 1
  while (end < lines.length && lines[end]?.startsWith('| ')) end += 1
  const rows = [...users]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, usedBy]) => `| \`${name}\` | ${licenses.get(name) ?? 'UNKNOWN'} | ${[...usedBy].sort().map((item) => `\`${item}\``).join(', ')} |`)
  lines.splice(separator + 1, end - separator - 1, ...rows)
  await writeFile(path, lines.join('\n'))
}

async function main(): Promise<number> {
  const root = process.cwd()
  const dirs: string[] = []
  for (const group of await listDirectories(join(root, 'packages'))) {
    for (const name of await listDirectories(join(root, 'packages', group))) dirs.push(join(root, 'packages', group, name))
  }
  for (const name of await listDirectories(join(root, 'apps'))) dirs.push(join(root, 'apps', name))

  const users = new Map<string, string[]>()
  const licenses = new Map<string, string>()
  const problems: string[] = []
  for (const dir of dirs) {
    const where = relative(root, dir).replaceAll('\\', '/')
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
    const runtime = { ...manifest['dependencies'], ...manifest['peerDependencies'], ...manifest['optionalDependencies'] }
    for (const [name, spec] of Object.entries(runtime)) {
      if (spec.startsWith('workspace:') || name.startsWith('@game-agent/')) continue
      users.set(name, [...(users.get(name) ?? []), where])
      if (licenses.has(name)) continue
      try {
        const installed = JSON.parse(await readFile(join(dir, 'node_modules', name, 'package.json'), 'utf8')) as { license?: unknown }
        licenses.set(name, typeof installed.license === 'string' ? installed.license : 'UNKNOWN')
      } catch {
        problems.push(`${name}: not installed for ${where}; run pnpm install`)
      }
    }
  }

  if (process.argv.includes('--write')) await writeTable(root, users, licenses)
  const allowed = await allowedLicenses(root)
  const table = await readTable(root)
  for (const [name, usedBy] of [...users].sort(([a], [b]) => a.localeCompare(b))) {
    const license = licenses.get(name)
    const row = table.get(name)
    if (license !== undefined && !licenseAllowed(license, allowed)) problems.push(`${name}: license ${license} is not in allow-licenses of ${POLICY_FILE}`)
    if (row === undefined) {
      problems.push(`${name}: runtime dependency of ${usedBy.join(', ')} is missing from ${NOTICES_FILE}`)
      continue
    }
    if (license !== undefined && row.license !== license) problems.push(`${name}: ${NOTICES_FILE} lists license ${row.license}, installed package declares ${license}`)
    const expected = [...usedBy].sort()
    if (expected.join(', ') !== [...row.usedBy].sort().join(', ')) problems.push(`${name}: "Used by" should list ${expected.join(', ')}`)
  }
  for (const name of table.keys()) if (!users.has(name)) problems.push(`${name}: listed in ${NOTICES_FILE} but no manifest uses it at runtime`)

  for (const problem of problems) process.stderr.write(`${problem}\n`)
  process.stdout.write(`check:notices checked ${users.size} runtime dependencies, ${problems.length} problem(s)\n`)
  return problems.length === 0 ? 0 : 1
}

process.exitCode = await main()
