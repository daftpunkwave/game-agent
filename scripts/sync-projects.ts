/**
 * Responsibilities: Keep the TypeScript project graph in step with the package graph: every workspace package and
 * application is a composite project that compiles `src` to `lib`, references exactly the workspace packages it
 * depends on, and is referenced by the root project.
 * Contracts: Without arguments, rewrites each `tsconfig.json` under `packages/<group>/<name>` and `apps/<name>`
 * and the root `tsconfig.json`, keeping any extra compiler options a project already sets. With `--check`, writes
 * nothing, prints every difference, and exits with code 1 when one exists.
 * Constraints: References come from `dependencies` and `peerDependencies` only; `devDependencies` serve tests,
 * which the root project type-checks, and would otherwise create reference cycles. Output is deterministic.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

interface Project {
  readonly name: string
  readonly dir: string
  readonly workspaceDependencies: readonly string[]
}

interface ProjectConfig {
  extends?: string
  compilerOptions?: Record<string, unknown>
  include?: string[]
  references?: { path: string }[]
  [key: string]: unknown
}

/** Compiler options this script owns in package projects; other options are kept as they are. */
const MANAGED_OPTIONS = ['rootDir', 'outDir', 'tsBuildInfoFile', 'composite', 'noEmit', 'declaration', 'emitDeclarationOnly', 'declarationMap']

const ROOT_INCLUDE = ['packages/*/*/tests/**/*', 'apps/*/tests/**/*', 'scripts/**/*', 'vitest.config.ts']
const ROOT_OPTIONS = { composite: false, noEmit: true, rewriteRelativeImportExtensions: false }

const root = process.cwd()
const toPosix = (path: string): string => path.replaceAll('\\', '/')

async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

async function collectProjects(): Promise<Project[]> {
  const dirs: string[] = []
  for (const group of await listDirectories(join(root, 'packages'))) {
    for (const name of await listDirectories(join(root, 'packages', group))) dirs.push(join(root, 'packages', group, name))
  }
  for (const name of await listDirectories(join(root, 'apps'))) dirs.push(join(root, 'apps', name))
  const manifests: { dir: string; manifest: { name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } }[] = []
  for (const dir of dirs) {
    const manifest = await readJson<{ name?: string }>(join(dir, 'package.json'))
    if (manifest?.name !== undefined) manifests.push({ dir, manifest })
  }
  const names = new Set(manifests.map(({ manifest }) => manifest.name))
  return manifests.map(({ dir, manifest }) => ({
    name: manifest.name as string,
    dir,
    workspaceDependencies: [...new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])]
      .filter((dependency) => names.has(dependency))
      .sort(),
  }))
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function packageConfig(project: Project, byName: ReadonlyMap<string, Project>, existing: ProjectConfig | undefined): ProjectConfig {
  const kept = Object.fromEntries(Object.entries(existing?.compilerOptions ?? {}).filter(([key]) => !MANAGED_OPTIONS.includes(key)))
  return {
    extends: toPosix(relative(project.dir, join(root, 'tsconfig.base.json'))),
    compilerOptions: { rootDir: 'src', outDir: 'lib', tsBuildInfoFile: 'lib/tsconfig.tsbuildinfo', ...kept },
    include: ['src'],
    references: project.workspaceDependencies.map((dependency) => ({
      path: toPosix(relative(project.dir, (byName.get(dependency) as Project).dir)),
    })),
  }
}

function rootConfig(projects: readonly Project[]): ProjectConfig {
  return {
    extends: './tsconfig.base.json',
    compilerOptions: ROOT_OPTIONS,
    include: ROOT_INCLUDE,
    references: projects.map((project) => ({ path: `./${toPosix(relative(root, project.dir))}` })),
  }
}

async function main(): Promise<number> {
  const check = process.argv.includes('--check')
  const projects = await collectProjects()
  const byName = new Map(projects.map((project) => [project.name, project]))
  const expected = new Map<string, string>()
  for (const project of projects) {
    const path = join(project.dir, 'tsconfig.json')
    expected.set(path, stringify(packageConfig(project, byName, await readJson<ProjectConfig>(path))))
  }
  expected.set(join(root, 'tsconfig.json'), stringify(rootConfig(projects)))

  const differences: string[] = []
  for (const [path, content] of expected) {
    const current = await readFile(path, 'utf8').catch(() => undefined)
    if (current?.replaceAll('\r\n', '\n') === content) continue
    differences.push(toPosix(relative(root, path)))
    if (!check) await writeFile(path, content)
  }
  if (check) {
    for (const path of differences) process.stdout.write(`${path}: out of date; run \`pnpm sync:projects\`\n`)
    process.stdout.write(`check:projects checked ${expected.size} project files, ${differences.length} out of date\n`)
    return differences.length === 0 ? 0 : 1
  }
  process.stdout.write(`sync:projects updated ${differences.length} of ${expected.size} project files\n`)
  return 0
}

process.exitCode = await main()
