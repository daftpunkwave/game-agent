/**
 * Responsibilities: Crop raw game data to what a human player could see, in three fixed stages: field whitelist, value coarsening, size budget.
 * Contracts: Unlisted views and event types are removed entirely (default deny); every removal, coarsening, and truncation is reported in the audit.
 * Constraints: Stage order is immutable so cost pressure can never delete a field before correctness decides it; inputs are never mutated.
 */
import type { JsonObject, JsonValue } from '@game-agent/contracts'
import { isJsonObject } from '@game-agent/contracts'

/** How a numeric value is made less precise before an agent sees it. */
export type Coarsening =
  | { readonly kind: 'bucket'; readonly size: number }
  | { readonly kind: 'bands'; readonly bands: readonly { readonly upTo: number; readonly label: string }[]; readonly above: string }
  | { readonly kind: 'significant'; readonly digits: number }

/** One visible field, addressed by a dotted path. */
export interface FieldRule {
  readonly path: string
  readonly coarsen?: Coarsening
}

/** Visible fields of one view or event type. */
export interface ViewRule {
  readonly fields: readonly FieldRule[]
  /** Monitoring labels attached to events of this type. */
  readonly tags?: readonly string[]
}

/** Size limits applied after whitelisting and coarsening. */
export interface VisibilityBudget {
  readonly maxStringLength: number
  readonly maxArrayItems: number
  readonly maxFieldsPerView: number
}

/** Complete visibility policy for one game. */
export interface VisibilityPolicy {
  readonly views: Readonly<Record<string, ViewRule>>
  readonly events: Readonly<Record<string, ViewRule>>
  readonly budget: VisibilityBudget
}

/** What cropping changed. */
export interface CropAudit {
  readonly removed: string[]
  readonly coarsened: string[]
  readonly truncated: string[]
}

function readPath(source: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = source
  for (const key of path.split('.')) {
    if (!isJsonObject(current)) return undefined
    current = current[key]
  }
  return current
}

function writePath(target: JsonObject, path: string, value: JsonValue): void {
  const keys = path.split('.')
  let current = target
  keys.slice(0, -1).forEach((key) => {
    const next = current[key]
    if (!isJsonObject(next)) current[key] = {}
    current = current[key] as JsonObject
  })
  current[keys[keys.length - 1] as string] = value
}

function collectRemoved(source: JsonObject, rules: readonly FieldRule[], prefix: string, removed: string[]): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (rules.some((rule) => rule.path === path || path.startsWith(`${rule.path}.`))) continue
    if (isJsonObject(value) && rules.some((rule) => rule.path.startsWith(`${path}.`))) {
      collectRemoved(value, rules, path, removed)
    } else {
      removed.push(path)
    }
  }
}

function coarsenValue(value: JsonValue, coarsening: Coarsening): JsonValue {
  if (typeof value !== 'number') return value
  switch (coarsening.kind) {
    case 'bucket':
      return Math.floor(value / coarsening.size) * coarsening.size
    case 'bands':
      return coarsening.bands.find((band) => value <= band.upTo)?.label ?? coarsening.above
    case 'significant':
      return value === 0 ? 0 : Number(value.toPrecision(coarsening.digits))
  }
}

function applyBudget(value: JsonValue, budget: VisibilityBudget, path: string, truncated: string[]): JsonValue {
  if (typeof value === 'string' && value.length > budget.maxStringLength) {
    truncated.push(path)
    return `${value.slice(0, budget.maxStringLength)}...`
  }
  if (Array.isArray(value)) {
    const kept = value.length > budget.maxArrayItems ? value.slice(0, budget.maxArrayItems) : value
    if (kept !== value) truncated.push(path)
    return kept.map((item, index) => applyBudget(item, budget, `${path}[${index}]`, truncated))
  }
  if (isJsonObject(value)) {
    const result: JsonObject = {}
    for (const [key, item] of Object.entries(value)) result[key] = applyBudget(item, budget, `${path}.${key}`, truncated)
    return result
  }
  return value
}

/**
 * Crop one object according to a view rule.
 * @param source - raw fields; not mutated.
 * @param rule - visible fields; `undefined` removes everything.
 * @param budget - size limits.
 */
export function cropFields(source: JsonObject, rule: ViewRule | undefined, budget: VisibilityBudget): { fields: JsonObject; audit: CropAudit } {
  const audit: CropAudit = { removed: [], coarsened: [], truncated: [] }
  const rules = rule?.fields ?? []

  // Stage 1: whitelist.
  collectRemoved(source, rules, '', audit.removed)
  const visible: { rule: FieldRule; value: JsonValue }[] = []
  for (const fieldRule of rules) {
    const value = readPath(source, fieldRule.path)
    if (value !== undefined) visible.push({ rule: fieldRule, value: structuredClone(value) })
  }

  // Stage 2: coarsen.
  for (const item of visible) {
    if (item.rule.coarsen === undefined) continue
    const next = coarsenValue(item.value, item.rule.coarsen)
    if (next !== item.value) audit.coarsened.push(item.rule.path)
    item.value = next
  }

  // Stage 3: budget.
  const fields: JsonObject = {}
  visible.forEach((item, index) => {
    if (index >= budget.maxFieldsPerView) {
      audit.truncated.push(item.rule.path)
      return
    }
    writePath(fields, item.rule.path, applyBudget(item.value, budget, item.rule.path, audit.truncated))
  })
  return { fields, audit }
}
