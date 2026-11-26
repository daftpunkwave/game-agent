/**
 * Responsibilities: Wrap player-authored text as untrusted data and attach heuristic flags that rule nodes can gate on.
 * Contracts: The text is preserved (length-capped) and never rewritten into instructions; flags only describe what the text asks for.
 * Constraints: Flags are heuristics, not a security boundary; authority over rules, identity, and assets is enforced elsewhere. Locales add patterns through configuration.
 */
import type { PlayerText, UntrustedText } from '@game-agent/contracts'

/** One heuristic screening rule. */
export interface TextScreenRule {
  readonly flag: string
  readonly pattern: RegExp
}

/** English baseline patterns; deployments append locale-specific rules. */
export const DEFAULT_SCREEN_RULES: readonly TextScreenRule[] = [
  {
    flag: 'claims-authority',
    pattern: /\b(ignore (all|any|previous|prior) (instructions|rules)|system prompt|you are now|developer mode|as (an? )?(admin|administrator|developer|game master))\b/i,
  },
  {
    flag: 'requests-assets',
    pattern: /\b(send|give|transfer|gift|donate|lend)\b.{0,40}\b(resources?|gold|gems?|food|wood|stone|troops?|items?)\b/i,
  },
  {
    flag: 'requests-commitment',
    pattern: /\b(promise|swear|guarantee|commit to)\b/i,
  },
]

/**
 * Wrap one piece of player text.
 * @param text - raw player text.
 * @param rules - screening rules to evaluate.
 * @param maxLength - characters kept from the original text.
 */
export function tagPlayerText(text: PlayerText, rules: readonly TextScreenRule[], maxLength: number): UntrustedText {
  const kept = text.text.length > maxLength ? `${text.text.slice(0, maxLength)}...` : text.text
  const flags = rules.filter((rule) => rule.pattern.test(text.text)).map((rule) => rule.flag)
  return { kind: 'untrusted-text', speaker: text.speaker, channel: text.channel, text: kept, flags }
}
