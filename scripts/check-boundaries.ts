/**
 * Responsibilities: Enforce package boundaries: declared dependencies, imports only through declared package entries, an acyclic package graph, layer rules for the game protocol and agent runtime packages, no Node I/O modules in cognition packages, and isolation of third-party SDKs.
 * Contracts: Scans `packages/<group>/<name>` and `apps/<name>`; prints every violation and exits with code 1 when any exists.
 * Constraints: Static text analysis of import specifiers; run with `node scripts/check-boundaries.ts` from the repository root.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

interface WorkspacePackage {
  readonly name: string
  readonly group: string
  readonly dir: string
  readonly dependencies: ReadonlySet<string>
  readonly devDependencies: ReadonlySet<string>
  /** Subpaths declared in `exports`, such as `./types`; `./src/*` is not a public entry. */
  readonly entries: ReadonlySet<string>
  /** Whether `exports` maps `./src/*` for the source condition, which lets tests reach individual modules. */
  readonly exposesSource: boolean
}

/**
 * Package groups each layered package may import at runtime (tests may use any declared dependency). The layer
 * rules apply to the game protocol and agent runtime packages in LAYERED_PACKAGES; capability packages (storage,
 * sessions, models, tools, and the like) are constrained by declared dependencies and the acyclic graph.
 */
const ALLOWED_GROUPS: Readonly<Record<string, readonly string[]>> = {
  kernel: ['kernel'],
  util: ['kernel', 'util'],
  protocol: ['kernel', 'util', 'protocol', 'telemetry'],
  telemetry: ['kernel', 'util', 'protocol'],
  behavior: ['kernel', 'util', 'protocol'],
  core: ['kernel', 'util', 'protocol', 'telemetry', 'behavior', 'core'],
  llm: ['kernel', 'util', 'protocol', 'core'],
  transport: ['kernel', 'util', 'protocol'],
  fleet: ['kernel', 'util', 'protocol', 'behavior'],
  boot: ['kernel', 'util', 'protocol', 'telemetry', 'behavior', 'core'],
  apps: ['kernel', 'util', 'protocol', 'telemetry', 'behavior', 'core', 'llm', 'transport', 'fleet', 'boot'],
}

/** Packages that follow the group layer rules in ALLOWED_GROUPS. */
const LAYERED_PACKAGES = new Set([
  '@game-agent/agent-runtime',
  '@game-agent/app',
  '@game-agent/behavior-tree',
  '@game-agent/cli',
  '@game-agent/contracts',
  '@game-agent/decision',
  '@game-agent/fleet',
  '@game-agent/gateway',
  '@game-agent/inbox',
  '@game-agent/intent-ledger',
  '@game-agent/model-openai-compatible',
  '@game-agent/ports',
  '@game-agent/trace',
  '@game-agent/transport-mcp',
  '@game-agent/transport-simulated',
])

/** Third-party packages confined to specific groups. */
const CONFINED_IMPORTS: readonly { readonly prefix: string; readonly groups: readonly string[] }[] = [
  { prefix: '@modelcontextprotocol/', groups: ['transport'] },
]

/**
 * Cognition packages decide what an agent does; they reach files, processes, and the network only through
 * gateways and injected ports, so they must not import Node I/O modules or socket libraries directly.
 */
const COGNITION_PACKAGES = new Set(['@game-agent/behavior-tree', '@game-agent/decision', '@game-agent/agent-runtime'])
const COGNITION_FORBIDDEN = ['node:net', 'node:http', 'node:https', 'node:child_process', 'node:fs', 'node:fs/promises', 'ws']

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s(?:(?!\b(?:import|export)\b)[^'"])*?from\s+['"]([^'"]+)['"]|(?<![.\w$])import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g

async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

async function listTypeScript(path: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const full = join(path, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') result.push(...(await listTypeScript(full)))
    else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.(ts|mts|cts)$/.test(entry.name)) result.push(full)
  }
  return result
}

async function loadPackage(dir: string, group: string): Promise<WorkspacePackage> {
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    exports?: unknown
  }
  const exportsField = manifest.exports
  const entries = typeof exportsField === 'object' && exportsField !== null && Object.keys(exportsField).every((key) => key.startsWith('.'))
    ? Object.keys(exportsField).filter((key) => key !== './src/*')
    : ['.']
  return {
    entries: new Set(entries),
    exposesSource: typeof exportsField === 'object' && exportsField !== null && Object.hasOwn(exportsField, './src/*'),
    name: manifest.name,
    group,
    dir,
    dependencies: new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]),
    devDependencies: new Set(Object.keys(manifest.devDependencies ?? {})),
  }
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

function findCycle(packages: readonly WorkspacePackage[]): string[] | undefined {
  const byName = new Map(packages.map((item) => [item.name, item]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (name: string): string[] | undefined => {
    if (state.get(name) === 'done') return undefined
    if (state.get(name) === 'visiting') return [...stack.slice(stack.indexOf(name)), name]
    state.set(name, 'visiting')
    stack.push(name)
    for (const dependency of byName.get(name)?.dependencies ?? []) {
      if (!byName.has(dependency)) continue
      const cycle = visit(dependency)
      if (cycle !== undefined) return cycle
    }
    stack.pop()
    state.set(name, 'done')
    return undefined
  }
  for (const item of packages) {
    const cycle = visit(item.name)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

async function main(): Promise<number> {
  const root = process.cwd()
  const packages: WorkspacePackage[] = []
  for (const group of await listDirectories(join(root, 'packages'))) {
    for (const name of await listDirectories(join(root, 'packages', group))) packages.push(await loadPackage(join(root, 'packages', group, name), group))
  }
  for (const name of await listDirectories(join(root, 'apps'))) packages.push(await loadPackage(join(root, 'apps', name), 'apps'))
  const workspace = new Map(packages.map((item) => [item.name, item]))
  const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> }
  const rootDevDependencies = new Set(Object.keys(rootManifest.devDependencies ?? {}))

  const violations: string[] = []
  for (const item of packages) {
    for (const kind of ['src', 'tests'] as const) {
      for (const file of await listTypeScript(join(item.dir, kind))) {
        const text = await readFile(file, 'utf8')
        const where = relative(root, file).replaceAll('\\', '/')
        for (const match of text.matchAll(IMPORT_PATTERN)) {
          const specifier = match[1] ?? match[2] ?? match[3]
          // Relative paths, template-built names, and URL-scheme specifiers (for example virtual modules a test registers) are not packages.
          if (specifier === undefined || specifier.startsWith('.') || specifier.includes('${') || /^[a-z][a-z0-9+.-]*:/.test(specifier) && !specifier.startsWith('node:') || specifier.startsWith('node:') && !COGNITION_FORBIDDEN.includes(specifier)) continue
          const name = packageNameOf(specifier)
          if (kind === 'src' && COGNITION_PACKAGES.has(item.name) && COGNITION_FORBIDDEN.includes(specifier)) {
            violations.push(`${where}: ${item.name} is a cognition package and must not import ${specifier}`)
            continue
          }
          // Tests may use the repository-wide test tooling declared in the root devDependencies.
          if (specifier.startsWith('node:') || kind === 'tests' && rootDevDependencies.has(name)) continue
          if (name === item.name) {
            // Tests may exercise the public entry of the package under test by name; sources import their own files relatively.
            if (kind !== 'tests') violations.push(`${where}: import files of the same package relatively, not as ${specifier}`)
            continue
          }
          const typeOnly = /^\s*(?:import|export)\s+type\s/.test(match[0])
          const declared = item.dependencies.has(name) || ((kind === 'tests' || typeOnly) && item.devDependencies.has(name))
          if (!declared) violations.push(`${where}: ${name} is imported but not declared in ${kind === 'src' ? 'dependencies' : 'dependencies or devDependencies'}`)
          const target = workspace.get(name)
          const subpath = `.${specifier.slice(name.length)}`
          // Tests may reach individual source modules (for example to mock them) when the package maps ./src/*.
          const testSourceImport = kind === 'tests' && target?.exposesSource === true && subpath.startsWith('./src/')
          if (target !== undefined && specifier !== name && !target.entries.has(subpath) && !testSourceImport) {
            violations.push(`${where}: ${specifier} is not an entry declared in the exports of ${name}`)
          }
          const targetGroup = target?.group
          if (kind === 'src' && LAYERED_PACKAGES.has(item.name) && targetGroup !== undefined && !(ALLOWED_GROUPS[item.group] ?? []).includes(targetGroup)) {
            violations.push(`${where}: ${item.group} packages must not depend on ${targetGroup} package ${name}`)
          }
          for (const confined of CONFINED_IMPORTS) {
            if (kind === 'src' && specifier.startsWith(confined.prefix) && !confined.groups.includes(item.group)) {
              violations.push(`${where}: ${specifier} may only be imported by ${confined.groups.join(', ')} packages`)
            }
          }
        }
      }
    }
  }
  const cycle = findCycle(packages)
  if (cycle !== undefined) violations.push(`dependency cycle: ${cycle.join(' -> ')}`)

  for (const violation of violations) process.stderr.write(`${violation}\n`)
  process.stdout.write(`check:boundaries scanned ${packages.length} packages, ${violations.length} violation(s)\n`)
  return violations.length === 0 ? 0 : 1
}

process.exitCode = await main()
