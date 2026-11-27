/**
 * Responsibilities: Configure the repository-wide Vitest run.
 * Contracts: Discovers tests under each package and application `tests/` directory. Workspace packages resolve
 * through the `@game-agent/source` export condition, so tests run against `src` and never need a build.
 * Constraints: Tests must stay order-independent; no global setup files are registered.
 */
import { defineConfig } from 'vitest/config'

/** Export condition that maps every workspace package entry to its TypeScript source. */
const SOURCE_CONDITION = '@game-agent/source'

export default defineConfig({
  resolve: {
    conditions: [SOURCE_CONDITION, 'module', 'browser', 'development|production'],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, 'module', 'node', 'development|production'],
      externalConditions: [SOURCE_CONDITION],
    },
  },
  test: {
    include: ['packages/*/*/tests/**/*.{test,spec}.ts', 'apps/*/tests/**/*.test.ts'],
    environment: 'node',
  },
})
