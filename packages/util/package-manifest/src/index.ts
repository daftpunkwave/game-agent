/**
 * Public package manifest and plugin display types, with no runtime exports.
 * @module @game-agent/package-manifest
 */

export type {
  ClientModuleStylesheetDescriptor,
  ClientModuleStyleContext,
  ClientModuleMeta,
  ClientModuleMetaFactory,
  ClientBundleRequire,
  ClientModuleFactory,
  GameAgentClientModuleManifest,
} from './client-module.ts'

export type {
  GameAgentBundleManifest,
  GameAgentClientManifest,
  GameAgentEnginesManifest,
  GameAgentManifest,
  GameAgentPackageManifest,
  GameAgentProfileManifest,
  LocalizedText,
  PluginLocalizedMeta,
} from './types.ts'
