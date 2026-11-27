/**
 * Responsibilities: Enforce package boundaries: declared dependencies, no deep imports, an acyclic package graph, layer rules between package groups, no Node I/O modules in cognition packages, and isolation of third-party SDKs.
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
}

/** Package groups each group may import at runtime (tests may use any declared dependency). */
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

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g

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
  }
  return {
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
  const workspaceGroups = new Map(packages.map((item) => [item.name, item.group]))

  const violations: string[] = []
  for (const item of packages) {
    for (const kind of ['src', 'tests'] as const) {
      for (const file of await listTypeScript(join(item.dir, kind))) {
        const text = await readFile(file, 'utf8')
        const where = relative(root, file).replaceAll('\\', '/')
        for (const match of text.matchAll(IMPORT_PATTERN)) {
          const specifier = match[1] ?? match[2] ?? match[3]
          if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('node:') && !COGNITION_FORBIDDEN.includes(specifier)) continue
          const name = packageNameOf(specifier)
          if (kind === 'src' && COGNITION_PACKAGES.has(item.name) && COGNITION_FORBIDDEN.includes(specifier)) {
            violations.push(`${where}: ${item.name} is a cognition package and must not import ${specifier}`)
            continue
          }
          if (specifier.startsWith('node:') || name === 'vitest') continue
          if (name === item.name) {
            // Tests may exercise the public entry of the package under test by name; sources import their own files relatively.
            if (kind !== 'tests') violations.push(`${where}: import files of the same package relatively, not as ${specifier}`)
            continue
          }
          const typeOnly = /^\s*(?:import|export)\s+type\s/.test(match[0])
          const declared = item.dependencies.has(name) || ((kind === 'tests' || typeOnly) && item.devDependencies.has(name))
          if (!declared) violations.push(`${where}: ${name} is imported but not declared in ${kind === 'src' ? 'dependencies' : 'dependencies or devDependencies'}`)
          if (name.startsWith('@game-agent/') && specifier !== name) violations.push(`${where}: deep import ${specifier}; use the package entry ${name}`)
          const targetGroup = workspaceGroups.get(name)
          if (kind === 'src' && targetGroup !== undefined && !(ALLOWED_GROUPS[item.group] ?? []).includes(targetGroup)) {
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
