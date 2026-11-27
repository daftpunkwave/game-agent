/** Bundle lists of the profiles game-agent creates on first use. */

/** Defaults for a profile that is created on first use. */
export interface ProfileTemplate {
  /** Ordered bundle layer list. */
  bundles: readonly string[]
}

/** Profile templates applied when a profile with the same name is first opened. */
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  web: {
    bundles: ['@game-agent/base', '@game-agent/web-app'],
  },
  headless: {
    bundles: ['@game-agent/base', '@game-agent/headless'],
  },
  sdk: {
    bundles: ['@game-agent/base', '@game-agent/sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@game-agent/sdk-minimal'],
  },
}

/**
 * Bundle lists that the installation itself owns for a profile name. A profile whose list equals the tuple is
 * replaced with the template of the same name; any other list is left as the user wrote it.
 */
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {}

/** Bundles that are no longer shipped; they are removed from profiles when found. */
export const RETIRED_BUNDLES: ReadonlySet<string> = new Set()
