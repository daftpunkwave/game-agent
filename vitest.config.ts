/**
 * Responsibilities: Configure the repository-wide Vitest run.
 * Contracts: Discovers tests under each package and application `tests/` directory.
 * Constraints: Tests must stay order-independent; no global setup files are registered.
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    environment: 'node',
  },
})
