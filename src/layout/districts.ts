/**
 * Z — the module district.
 *
 * A module is a slab at a fixed Z spanning the full X and Y extent of the map, so it reads as
 * a vertical wall of nodes cutting through every layer. That matters because modules are not
 * layer-homogeneous: `module/leave` in the sample has members in interface, logic AND data.
 *
 * Districts are ordered alphabetically and packed densely from z = 0, never rescaled.
 */

import type { Graph, GraphNode } from '../schema/graph.js'
import { COMMONS_KEY, MODULE_PITCH } from './constants.js'
import { cmpId } from './hash.js'

export interface Districts {
  /** Module key -> district Z. */
  z: Map<string, number>
  /** Module key -> display name. */
  name: Map<string, string>
  /** Keys in placement order. */
  order: string[]
}

/**
 * Which district a node belongs to.
 *
 * Defensive on purpose. The parser attaches `module: "Leave"` to implicit error nodes but
 * gives them no `parentId`, since parentId is stamped when the module container is built and
 * error nodes are created afterwards. Without the name fallback those errors would land in a
 * different district from the module they belong to — and an error would float away from its
 * own cause, which is the one thing the error terrace exists to prevent.
 */
export function moduleKeyOf(node: GraphNode, moduleIdByName: Map<string, string>): string {
  if (node.parentId) return node.parentId
  if (node.module) {
    return moduleIdByName.get(node.module) ?? `module/${slug(node.module)}`
  }
  return COMMONS_KEY
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function computeDistricts(graph: Graph, nodes: GraphNode[]): Districts {
  const moduleIdByName = new Map<string, string>()
  const displayName = new Map<string, string>()

  for (const node of graph.nodes) {
    if (node.kind !== 'module') continue
    moduleIdByName.set(node.name, node.id)
    displayName.set(node.id, node.name)
  }

  const keys = new Set<string>()
  for (const node of nodes) {
    const key = moduleKeyOf(node, moduleIdByName)
    keys.add(key)
    if (!displayName.has(key) && node.module) displayName.set(key, node.module)
  }

  const named = [...keys]
    .filter((key) => key !== COMMONS_KEY)
    .sort((a, b) => cmpId(displayName.get(a) ?? a, displayName.get(b) ?? b) || cmpId(a, b))

  // Commons sits first so that adding the document's first real module never moves the
  // ungrouped nodes, and so a module-less document (function scope) degenerates to a single
  // district at z = 0 — a clean 2D X/Y ribbon, which is the right picture for one function.
  const order = keys.has(COMMONS_KEY) ? [COMMONS_KEY, ...named] : named

  const z = new Map<string, number>()
  order.forEach((key, index) => z.set(key, index * MODULE_PITCH))

  const name = new Map<string, string>()
  for (const key of order) {
    name.set(key, key === COMMONS_KEY ? 'Ungrouped' : (displayName.get(key) ?? key))
  }

  return { z, name, order }
}
