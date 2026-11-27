/**
 * Responsibilities: Provide immutable, path-addressed edits for behavior trees so editors (CLI, web, desktop) share one editing model.
 * Contracts: Every edit returns a new definition with `version` incremented; the input is never mutated. Paths use `root/<index>/...`.
 * Constraints: Edits do not validate semantics; callers run `validateTreeDefinition` before publishing.
 */
import { GameAgentError } from '@game-agent/error'
import { ROOT_PATH, childPath, childrenOf, type NodeDefinition, type TreeDefinition } from './definition.ts'

function segments(path: string): number[] {
  if (path === ROOT_PATH) return []
  if (!path.startsWith(`${ROOT_PATH}/`)) throw new GameAgentError(`Invalid node path ${path}`, 'INVALID_NODE_PATH')
  return path
    .slice(ROOT_PATH.length + 1)
    .split('/')
    .map((part) => {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0) throw new GameAgentError(`Invalid node path ${path}`, 'INVALID_NODE_PATH')
      return index
    })
}

function withChildren(node: NodeDefinition, children: readonly NodeDefinition[]): NodeDefinition {
  switch (node.type) {
    case 'sequence':
    case 'selector':
    case 'parallel':
      return { ...node, children }
    case 'inverter':
    case 'cooldown':
    case 'schedule': {
      const [child] = children
      if (child === undefined || children.length !== 1) throw new GameAgentError(`${node.type} must keep exactly one child`, 'INVALID_EDIT')
      return { ...node, child }
    }
    default:
      throw new GameAgentError(`${node.type} has no children`, 'INVALID_EDIT')
  }
}

function update(node: NodeDefinition, path: number[], change: (target: NodeDefinition) => NodeDefinition): NodeDefinition {
  const [head, ...rest] = path
  if (head === undefined) return change(node)
  const children = childrenOf(node)
  const child = children[head]
  if (child === undefined) throw new GameAgentError(`No child ${head} under ${node.type}`, 'INVALID_NODE_PATH')
  const next = [...children]
  next[head] = update(child, rest, change)
  return withChildren(node, next)
}

function bump(tree: TreeDefinition, root: NodeDefinition): TreeDefinition {
  return { ...tree, version: tree.version + 1, root }
}

/** Read the node at `path`. */
export function nodeAt(tree: TreeDefinition, path: string): NodeDefinition {
  let node = tree.root
  for (const index of segments(path)) {
    const child = childrenOf(node)[index]
    if (child === undefined) throw new GameAgentError(`No node at ${path}`, 'INVALID_NODE_PATH')
    node = child
  }
  return node
}

/** Replace the node at `path`. */
export function replaceNode(tree: TreeDefinition, path: string, replacement: NodeDefinition): TreeDefinition {
  return bump(tree, update(tree.root, segments(path), () => replacement))
}

/** Insert `node` as child `index` of the composite at `parentPath`. */
export function insertChild(tree: TreeDefinition, parentPath: string, index: number, node: NodeDefinition): TreeDefinition {
  return bump(
    tree,
    update(tree.root, segments(parentPath), (parent) => {
      const children = [...childrenOf(parent)]
      if (index < 0 || index > children.length) throw new GameAgentError(`Index ${index} is out of range`, 'INVALID_EDIT')
      children.splice(index, 0, node)
      return withChildren(parent, children)
    }),
  )
}

/** Remove the node at `path`; the root cannot be removed. */
export function removeNode(tree: TreeDefinition, path: string): TreeDefinition {
  const parts = segments(path)
  const index = parts.pop()
  if (index === undefined) throw new GameAgentError('The root node cannot be removed', 'INVALID_EDIT')
  return bump(
    tree,
    update(tree.root, parts, (parent) => {
      const children = childrenOf(parent).filter((_, position) => position !== index)
      return withChildren(parent, children)
    }),
  )
}

/** Depth-first list of every node with its path, for editors and outlines. */
export function listNodes(tree: TreeDefinition): { path: string; depth: number; node: NodeDefinition }[] {
  const result: { path: string; depth: number; node: NodeDefinition }[] = []
  const visit = (node: NodeDefinition, path: string, depth: number): void => {
    result.push({ path, depth, node })
    childrenOf(node).forEach((child, index) => visit(child, childPath(path, index), depth + 1))
  }
  visit(tree.root, ROOT_PATH, 0)
  return result
}
