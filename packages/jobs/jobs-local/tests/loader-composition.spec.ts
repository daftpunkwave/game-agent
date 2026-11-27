import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@game-agent/kernel'
import Include from '@game-agent/kernel-include'
import Loader from '@game-agent/kernel-loader'
import LocalJobRegistry from '@game-agent/jobs-local'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('jobs-local through a real Loader composition', () => {
  it('applies the provider-owned admission config from a Kernel row', async () => {
    root = await mkdtemp(join(tmpdir(), 'game-agent-jobs-local-loader-'))
    const configPath = join(root, 'game-agent.yml')
    await writeFile(configPath, [
      "- name: '@game-agent/jobs-local'",
      '  config:',
      '    maxConcurrentJobsPerOwner: 1',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@game-agent/jobs-local') return LocalJobRegistry
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'kernel:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.jobs).toBeInstanceOf(LocalJobRegistry)
    context.jobs.attachController('loader-test')
    let settle!: (outcome: { status: 'killed' }) => void
    context.jobs.start({
      kind: 'bash',
      label: 'hold loader slot',
      run: () => ({
        cancel: () => { settle({ status: 'killed' }) },
        done: new Promise((resolve) => { settle = resolve }),
      }),
    })
    expect(() => context!.jobs.start({
      kind: 'bash',
      label: 'blocked loader job',
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })).toThrow('(limit: 1)')
  })
})
