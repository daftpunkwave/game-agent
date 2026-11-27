/** Mount source modules through a real profile, patch file, and reload coordinator. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@game-agent/kernel'
import { parseEntryYaml, stringifyEntryYaml } from '@game-agent/kernel-include'
import type { EntryOptions } from '@game-agent/kernel-loader'
import Timer from '@game-agent/kernel-timer'
import { initProfile, mountRootInclude, readProfilePatches, type ProfileContext } from '@game-agent/app-boot'
import Hmr from '@game-agent/hmr'
import ConfigEditor from '@game-agent/config-editor'
import Settings from '../src/index.ts'

/** Attach the profile runtime to an initialized Loader with a source-module importer. */
export async function profileComposition(ctx: Context, home: string, baseFile: string): Promise<string> {
  const dir = join(home, 'profile')
  initProfile(dir, ['test-profile-bundle'])
  const bundle = join(dir, 'node_modules', 'test-profile-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-profile-bundle', version: '1.0.0', gameAgent: { bundle: { patch: 'game-agent.patch.yml' } } }))
  const rows = parseEntryYaml(await readFile(baseFile, 'utf8')) as EntryOptions[]
  for (const row of rows) row.id ??= row.name.replace('@game-agent/', '')
  await writeFile(join(bundle, 'game-agent.patch.yml'), stringifyEntryYaml([{ insert: rows }]))
  await writeFile(join(dir, 'game-agent.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-profile-bundle'], dir, patchPath: join(dir, 'game-agent.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlayPaths: [], telemetryDisabledEnv: undefined,
  }
  ctx.provide('profileContext', profile)
  ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await mountRootInclude(ctx, join(dir, 'game-agent.yml'), readProfilePatches('test', profile))
  await ctx.loader.await()
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await ctx.hmr.runExclusive(async () => {})
  return profile.patchPath
}
