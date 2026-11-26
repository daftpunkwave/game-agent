/**
 * Responsibilities: Register a DeepSeek Harness session preset so that choosing it in a new conversation creates a game-playing agent session.
 * Contracts: The preset copies every plugin row of the base preset and appends the game connection rows; it is removed when this plugin unloads.
 * Constraints: Integration code; DSH services are looked up at runtime with `ctx.get` and retried, because declaring them as hard dependencies would stop the plugin from loading on DSH builds without them.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Plugin row as used in DSH profile and preset composition. */
export interface PluginRow {
  readonly id: string
  readonly name: string
  readonly config?: Record<string, unknown>
}

/** Minimal view of the DSH `agentPresets` service. */
interface AgentPresetService {
  definitions: { get(id: string): { config: { plugins: readonly PluginRow[] } } | undefined; has(id: string): boolean }
  register(definition: { id: string; name: string; description: string; order: number; plugins: PluginRow[] }): Promise<(() => unknown) | undefined>
}

/** Game connection used by the preset. */
export interface GameMcpEndpoint {
  readonly serverName: string
  readonly url: string
  readonly toolTimeoutMs: number
}

/** Preset settings. */
export interface PresetConfig {
  readonly presetId: string
  readonly presetName: string
  readonly basePreset: string
  readonly game?: GameMcpEndpoint
  readonly retryAttempts: number
  readonly retryIntervalMs: number
}

/** Rows appended to the base preset. */
export function gameRows(config: PresetConfig): PluginRow[] {
  const rows: PluginRow[] = [{ id: 'game-agent-console', name: '@game-agent/dsh-bundle', config: { consoleOnly: true } }]
  if (config.game !== undefined) {
    rows.unshift({
      id: `mcp-${config.game.serverName}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: config.game.serverName, transport: 'streamable-http', url: config.game.url, toolCallTimeoutMs: config.game.toolTimeoutMs },
    })
  }
  return rows
}

/** Register the preset once DSH's preset service and the base preset are available. */
export function registerPreset(ctx: Context, config: PresetConfig, log: (level: 'info' | 'warn', message: string) => void): void {
  ctx.effect(() => {
    let disposed = false
    let attempts = 0
    let unregister: (() => unknown) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const attempt = async (): Promise<void> => {
      if (disposed) return
      const presets = ctx.get('agentPresets') as AgentPresetService | undefined
      const base = presets?.definitions.get(config.basePreset)
      if (presets === undefined || base === undefined) {
        attempts += 1
        if (attempts < config.retryAttempts) timer = setTimeout(() => void attempt(), config.retryIntervalMs)
        else log('warn', presets === undefined ? 'this DSH build has no preset service; preset not created' : `base preset ${config.basePreset} not found; preset not created`)
        return
      }
      if (presets.definitions.has(config.presetId)) {
        log('warn', `a preset with id ${config.presetId} already exists; not created again`)
        return
      }
      const remove = await presets.register({
        id: config.presetId,
        name: config.presetName,
        description: `${config.basePreset} plus game-agent: behavior-tree autopilot, bounded AI decisions, and game tools`,
        order: 50,
        plugins: [...base.config.plugins.map((row) => ({ ...row })), ...gameRows(config)],
      })
      if (disposed) await remove?.()
      else {
        unregister = remove
        log('info', `preset ${config.presetName} (${config.presetId}) is available for new sessions`)
      }
    }
    timer = setTimeout(() => void attempt(), 0)
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      void unregister?.()
    }
  })
}
