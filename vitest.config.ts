/**
 * Responsibilities: Configure the repository-wide Vitest run.
 * Contracts: Discovers tests under each package and application `tests/` directory. Workspace packages resolve
 * through the `@game-agent/source` export condition, so tests run against `src` and never need a build. Standard
 * decorators are lowered with the TypeScript compiler before Vite parses a file. Suites that load modules through
 * the VM API run in a separate lane with `--experimental-vm-modules`.
 * Constraints: Tests must stay order-independent. Every suite runs in a forked worker, because Node.js 24 can
 * abort in its CommonJS lexer inside worker threads. Suites that need POSIX process semantics are excluded on
 * Windows and run on Linux, as does one resolution matrix that does not complete on Windows.
 */
import ts from 'typescript'
import { defineConfig, type Plugin } from 'vitest/config'

/** Export condition that maps every workspace package entry to its TypeScript source. */
const SOURCE_CONDITION = '@game-agent/source'

const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m

/** Lower standard decorators with the TypeScript compiler; Vite's own TypeScript transform cannot parse them. */
function standardDecorators(): Plugin {
  return {
    name: 'game-agent-standard-decorators',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/.test(file) || !DECORATOR_SYNTAX.test(code)) return undefined
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith('x') ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText ?? null,
      }
    },
  }
}

const INCLUDE = ['packages/*/*/tests/**/*.{test,spec}.ts', 'apps/*/tests/**/*.test.ts']

/** Suites that import modules through the VM API and need `--experimental-vm-modules`. */
const PROCESS_BOUND = [
  'packages/session/session-persistence-jsonl/tests/jsonl.spec.ts',
  'packages/subprocess/subprocess-local/tests/process-exit.spec.ts',
  'packages/subprocess/subprocess-local/tests/spawn.spec.ts',
  'packages/context/time-context/tests/time-context.spec.ts',
  'packages/boot/app-boot/tests/app-boot.spec.ts',
  'packages/workflow/workflow-ptc/tests/workflow-ptc.spec.ts',
  'packages/ptc-runtime/ptc-runtime-node/tests/imports.spec.ts',
]

/** Suites whose oracle is POSIX process behavior; Windows runs the Windows-specific suites instead. */
const POSIX_ONLY = process.platform === 'win32'
  ? [
      'packages/subprocess/subprocess/tests/**/*.spec.ts',
      'packages/subprocess/subprocess-local/tests/local.spec.ts',
      'packages/subprocess/subprocess-local/tests/process-inspector.spec.ts',
      'packages/subprocess/subprocess-local/tests/spawn.spec.ts',
      'packages/subprocess/subprocess-local/tests/terminal.spec.ts',
      // The 4,800-case linked-package resolution matrix builds directory links in bulk; on Windows its forked
      // worker exits or stalls partway through. The resolution logic is platform-neutral and runs on Linux.
      'packages/boot/app-boot/tests/linked-resolution-matrix.spec.ts',
    ]
  : []

const shared = {
  plugins: [standardDecorators()],
  resolve: { conditions: [SOURCE_CONDITION, 'module', 'browser', 'development|production'] },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, 'module', 'node', 'development|production'],
      externalConditions: [SOURCE_CONDITION],
    },
  },
}

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: 'default',
          include: INCLUDE,
          exclude: ['**/node_modules/**', ...PROCESS_BOUND, ...POSIX_ONLY],
          environment: 'node',
          pool: 'forks',
          setupFiles: ['./scripts/test-setup.ts'],
        },
      },
      {
        ...shared,
        test: {
          name: 'process-bound',
          include: PROCESS_BOUND,
          exclude: ['**/node_modules/**', ...POSIX_ONLY],
          environment: 'node',
          pool: 'forks',
          execArgv: ['--experimental-vm-modules'],
          setupFiles: ['./scripts/test-setup.ts'],
        },
      },
    ],
  },
})
