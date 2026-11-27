/** A declarative preset row in an ordinary Kernel composition. */
import { Context, Service } from '@game-agent/kernel'
import { EntryGroup } from '@game-agent/kernel-loader'
import z from '@game-agent/schema'
import type { PresetDefinition } from '@game-agent/agent-preset-registry'
import type {} from '@game-agent/agent-preset-registry'

/** Definition submitted to the preset registry. */
export type Config = PresetDefinition

/** Registers child plugin configuration without owning Agents using older revisions. */
export default class AgentPreset {
  static inject = ['agentPresets']
  /** Preserve child expressions until their own plugins activate. */
  static readonly [EntryGroup.key] = true
  static Config: z<Config> = z.object({
    id: z.string().required(),
    name: z.string(),
    description: z.string(),
    order: z.number(),
    // Kernel owns individual plugin schemas; the registry validates entry structure.
    plugins: z.array(z.any()).required(),
  }) as z<Config>

  constructor(private readonly ctx: Context, private readonly config: Config) {}

  async* [Service.init]() {
    yield await this.ctx.agentPresets.register(this.config)
  }
}
