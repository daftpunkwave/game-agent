/** Worker bootstrap installs only the resolution inherited from its parent. */

import { beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeResolution } from '../src/profile.ts'

const rig = vi.hoisted(() => ({
  data: undefined as {
    resolution: RuntimeResolution
  } | undefined,
  install: vi.fn(),
}))

vi.mock('node:worker_threads', () => ({
  getEnvironmentData: () => rig.data,
}))

vi.mock('../src/profile-resolution/resolver.ts', () => ({
  installRuntimeInterception: rig.install,
}))

beforeEach(() => {
  rig.data = undefined
  rig.install.mockReset()
  vi.resetModules()
})

it('does nothing without inherited profile resolution data', async () => {
  await import('../src/profile-resolution/worker-bootstrap.ts')
  expect(rig.install).not.toHaveBeenCalled()
})

it('installs the inherited resolution', async () => {
  const resolution: RuntimeResolution = {
    profilesDir: '/profiles',
    profileDir: '/profiles/test',
    localPackageNames: [],
    linkedRoots: [],
    entries: [],
  }
  rig.data = { resolution }
  await import('../src/profile-resolution/worker-bootstrap.ts')
  expect(rig.install).toHaveBeenCalledWith(resolution)
})
