/**
 * Responsibilities: Cordis plugin entry loaded by DeepSeek Harness for local play: creates the game-agent session preset and the `game_agent` tool.
 * Contracts: Loaded once at profile level (registers the preset) and once per preset session with `consoleOnly` (registers the tool only).
 * Constraints: Depends on Cordis and game-agent packages only; DSH services are optional at runtime.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerConsoleTool } from './console-tool.ts'
import { registerPreset, type GameMcpEndpoint } from './preset.ts'

export * from './console-tool.ts'
export * from './preset.ts'

/** Plugin name used in profile rows. */
export const name = '@game-agent/dsh-bundle'

/** User-facing configuration. */
export interface Config {
  readonly consoleOnly?: boolean
  readonly presetName?: string
  readonly basePreset?: string
  readonly game?: GameMcpEndpoint
}

/** Cordis entry point. */
export function apply(ctx: Context, config: Config = {}): void {
  const log = (level: 'info' | 'warn', message: string): void => {
    ctx.logger[level](message)
  }
  registerConsoleTool(ctx, log)
  if (config.consoleOnly === true) return
  registerPreset(
    ctx,
    {
      presetId: 'game-agent',
      presetName: config.presetName ?? 'game-agent',
      basePreset: config.basePreset ?? 'standard',
      retryAttempts: 60,
      retryIntervalMs: 2_000,
      ...(config.game === undefined ? {} : { game: config.game }),
    },
    log,
  )
}
