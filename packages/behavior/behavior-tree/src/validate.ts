/**
 * Responsibilities: Check that untrusted JSON is a well-formed behavior tree before anyone runs or publishes it.
 * Contracts: Returns every problem with its node path; a valid result carries the typed definition unchanged.
 * Constraints: Pure function; optional catalogs turn unknown conditions and actions into errors.
 */
import { isJsonObject, type JsonValue } from '@game-agent/contracts'
import { NODE_TYPES, ROOT_PATH, TREE_FORMAT, childPath, type TreeDefinition } from './definition.ts'

/** One validation problem. */
export interface TreeProblem {
  readonly path: string
  readonly message: string
}

/** Outcome of {@link validateTreeDefinition}. */
export type TreeValidation = { readonly ok: true; readonly tree: TreeDefinition } | { readonly ok: false; readonly problems: readonly TreeProblem[] }

/** Optional catalogs used to reject references the runtime cannot resolve. */
export interface TreeCatalogs {
  readonly conditions?: ReadonlySet<string>
  readonly actions?: ReadonlySet<string>
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateNode(node: JsonValue | undefined, path: string, catalogs: TreeCatalogs, problems: TreeProblem[]): void {
  const report = (message: string): void => {
    problems.push({ path, message })
  }
  if (!isJsonObject(node)) {
    report('node must be an object')
    return
  }
  const type = node['type']
  if (typeof type !== 'string' || !(NODE_TYPES as readonly string[]).includes(type)) {
    report(`unknown node type ${JSON.stringify(type)}`)
    return
  }
  if (node['name'] !== undefined && typeof node['name'] !== 'string') report('name must be a string')

  const children = (key: 'children'): void => {
    const list = node[key]
    if (!Array.isArray(list) || list.length === 0) {
      report('children must be a non-empty array')
      return
    }
    list.forEach((child, index) => validateNode(child, childPath(path, index), catalogs, problems))
  }
  const single = (): void => validateNode(node['child'], childPath(path, 0), catalogs, problems)

  switch (type) {
    case 'sequence':
    case 'selector':
      children('children')
      return
    case 'parallel': {
      children('children')
      const count = Array.isArray(node['children']) ? node['children'].length : 0
      const threshold = node['successThreshold']
      if (!isPositiveInteger(threshold) || threshold > count) report('successThreshold must be an integer between 1 and the number of children')
      return
    }
    case 'inverter':
      single()
      return
    case 'cooldown':
      if (!isPositiveInteger(node['ms'])) report('ms must be a positive integer')
      single()
      return
    case 'schedule': {
      const windows = node['windows']
      if (!Array.isArray(windows) || windows.length === 0) report('windows must be a non-empty array')
      else
        windows.forEach((window, index) => {
          if (!isJsonObject(window) || typeof window['start'] !== 'string' || typeof window['end'] !== 'string' || !TIME_PATTERN.test(window['start']) || !TIME_PATTERN.test(window['end'])) {
            report(`windows[${index}] must have start and end in HH:MM`)
          }
        })
      const offset = node['utcOffsetMinutes']
      if (typeof offset !== 'number' || !Number.isInteger(offset) || Math.abs(offset) > 14 * 60) report('utcOffsetMinutes must be an integer within +/-840')
      single()
      return
    }
    case 'condition':
      if (!isNonEmptyString(node['check'])) report('check must be a non-empty string')
      else if (catalogs.conditions !== undefined && !catalogs.conditions.has(node['check'])) report(`unknown condition ${node['check']}`)
      if (node['args'] !== undefined && !isJsonObject(node['args'])) report('args must be an object')
      return
    case 'action':
      if (!isNonEmptyString(node['action'])) report('action must be a non-empty string')
      else if (catalogs.actions !== undefined && !catalogs.actions.has(node['action'])) report(`unknown action ${node['action']}`)
      if (node['args'] !== undefined && !isJsonObject(node['args'])) report('args must be an object')
      if (node['store'] !== undefined && !isNonEmptyString(node['store'])) report('store must be a non-empty string')
      return
    case 'decision': {
      if (!isNonEmptyString(node['purpose'])) report('purpose must be a non-empty string')
      const tools = node['tools']
      if (!Array.isArray(tools) || tools.length === 0 || !tools.every(isNonEmptyString)) report('tools must be a non-empty array of action names')
      else if (catalogs.actions !== undefined) {
        for (const tool of tools) if (!catalogs.actions.has(tool)) report(`unknown tool ${tool}`)
      }
      if (!isPositiveInteger(node['maxProposals'])) report('maxProposals must be a positive integer')
      if (!isPositiveInteger(node['timeoutMs'])) report('timeoutMs must be a positive integer')
      if (node['store'] !== undefined && !isNonEmptyString(node['store'])) report('store must be a non-empty string')
      return
    }
    case 'wait-event':
      if (!isNonEmptyString(node['eventType'])) report('eventType must be a non-empty string')
      if (!isPositiveInteger(node['timeoutMs'])) report('timeoutMs must be a positive integer')
      return
    case 'set':
      if (!isNonEmptyString(node['key'])) report('key must be a non-empty string')
      if (!('value' in node)) report('value is required')
      return
  }
}

/**
 * Validate an untrusted JSON value as a behavior tree definition.
 * @param input - parsed JSON.
 * @param catalogs - optional known conditions and actions.
 */
export function validateTreeDefinition(input: unknown, catalogs: TreeCatalogs = {}): TreeValidation {
  const problems: TreeProblem[] = []
  if (!isJsonObject(input as JsonValue)) return { ok: false, problems: [{ path: '$', message: 'tree must be an object' }] }
  const tree = input as Record<string, JsonValue>
  if (tree['format'] !== TREE_FORMAT) problems.push({ path: '$.format', message: `format must be ${TREE_FORMAT}` })
  if (!isNonEmptyString(tree['id'])) problems.push({ path: '$.id', message: 'id must be a non-empty string' })
  if (!isPositiveInteger(tree['version'])) problems.push({ path: '$.version', message: 'version must be a positive integer' })
  validateNode(tree['root'], ROOT_PATH, catalogs, problems)
  return problems.length === 0 ? { ok: true, tree: input as TreeDefinition } : { ok: false, problems }
}
