import type { Graph, GraphEdge, GraphNode } from '../../schema/graph.js'
import { LAYERS, type EdgeKind, type Layer } from '../../schema/kinds.js'

export interface Filters {
  layers: ReadonlySet<Layer>
  roles: ReadonlySet<string>
  query: string
}

/** Container nodes are drawn as group boxes, never as nodes in their own right. */
export const isDrawable = (node: GraphNode) => node.kind !== 'module'

export function layersPresent(graph: Graph): Layer[] {
  const present = new Set(graph.nodes.filter(isDrawable).map((n) => n.layer))
  return LAYERS.filter((layer) => present.has(layer))
}

export function rolesPresent(graph: Graph): string[] {
  const roles = new Set<string>()
  for (const workflow of graph.workflows) {
    for (const role of workflow.roles) roles.add(role)
    for (const step of workflow.steps) if (step.role) roles.add(step.role)
  }
  return [...roles].sort()
}

export function matchesQuery(node: GraphNode, query: string): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  return (
    node.id.includes(needle) ||
    node.name.toLowerCase().includes(needle) ||
    (node.module?.toLowerCase().includes(needle) ?? false) ||
    (node.description?.toLowerCase().includes(needle) ?? false) ||
    Object.values(node.meta).some((v) => v.toLowerCase().includes(needle))
  )
}

/**
 * Role filtering uses `rolesReached` — the roles that actually arrive at a node through some
 * workflow — rather than the `roles` a node declares. A service is not "an Employee thing";
 * it is reached by an Employee path, and two roles routinely share one service.
 */
export function applyFilters(nodes: GraphNode[], filters: Filters): GraphNode[] {
  return nodes.filter((node) => {
    if (!filters.layers.has(node.layer)) return false
    if (filters.roles.size > 0) {
      const reached = node.rolesReached.some((role) => filters.roles.has(role))
      if (!reached) return false
    }
    return matchesQuery(node, filters.query)
  })
}

export interface WorkflowView {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Step numbers per node id — a node visited twice in one flow carries both. */
  steps: Map<string, number[]>
}

/**
 * Everything one workflow touches: its ordered steps plus the error nodes branching off it.
 * This is the view worth reading — a linear-ish DAG, not the whole system.
 */
export function workflowView(graph: Graph, workflowId: string): WorkflowView | null {
  const workflow = graph.workflows.find((w) => w.id === workflowId)
  if (!workflow) return null

  const ids = new Set<string>()
  const steps = new Map<string, number[]>()
  for (const step of workflow.steps) {
    ids.add(step.nodeId)
    const existing = steps.get(step.nodeId) ?? []
    existing.push(step.order)
    steps.set(step.nodeId, existing)
  }
  for (const error of workflow.errors) {
    ids.add(error.atNodeId)
    ids.add(error.errorNodeId)
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return {
    nodes: [...ids].map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n)),
    edges: graph.edges.filter((e) => e.workflowId === workflowId),
    steps,
  }
}

export interface NodeConnections {
  incoming: GraphEdge[]
  outgoing: GraphEdge[]
}

export function connectionsOf(graph: Graph, nodeId: string): NodeConnections {
  return {
    incoming: graph.edges.filter((e) => e.to === nodeId && e.kind !== 'contains'),
    outgoing: graph.edges.filter((e) => e.from === nodeId && e.kind !== 'contains'),
  }
}

/**
 * Above this many connections the overview stops drawing them all and waits for a selection.
 * Below it, a hairball is not a risk and hiding the structure is just unhelpful.
 */
export const OVERVIEW_EDGE_LIMIT = 120

/**
 * Which edges the overview draws.
 *
 * Originally this drew nothing until you selected a node, on the theory that the overview
 * answers "what exists and where does it sit" and a full edge set turns that into a
 * hairball. That holds for a hand-written document full of workflows — and fails badly for a
 * scanner draft, where `contains` edges are the group boxes and the handful of real
 * connections were the only thing worth seeing. So: show them when there are few enough to
 * stay readable.
 */
export function overviewEdges(graph: Graph, selectedId: string | null): GraphEdge[] {
  if (selectedId) {
    return graph.edges.filter((e) => e.from === selectedId || e.to === selectedId)
  }
  const structural = graph.edges.filter((e) => e.kind !== 'contains')
  return structural.length <= OVERVIEW_EDGE_LIMIT ? structural : []
}

export function neighbourIds(graph: Graph, nodeId: string): Set<string> {
  const { incoming, outgoing } = connectionsOf(graph, nodeId)
  const ids = new Set<string>([nodeId])
  for (const edge of incoming) ids.add(edge.from)
  for (const edge of outgoing) ids.add(edge.to)
  return ids
}

/**
 * Nodes to draw once collapsed modules are folded away.
 *
 * A collapsed module is replaced by a single stand-in carrying the member count. Collapse is
 * pure visibility — no position anywhere else changes, because no node's address depends on
 * another module's member count. That is what makes expanding restore the map exactly, and
 * it is a property of the layout rather than something this function has to arrange.
 */
export function foldCollapsed(
  nodes: GraphNode[],
  collapsed: ReadonlySet<string>,
): GraphNode[] {
  if (collapsed.size === 0) return nodes

  const kept: GraphNode[] = []
  const counts = new Map<string, GraphNode[]>()

  for (const node of nodes) {
    const module = node.module ?? ''
    if (!collapsed.has(module)) {
      kept.push(node)
      continue
    }
    const bucket = counts.get(module)
    if (bucket) bucket.push(node)
    else counts.set(module, [node])
  }

  for (const [module, members] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = members[0]!
    kept.push({
      ...first,
      id: `collapsed/${module || 'ungrouped'}`,
      kind: 'module',
      // Sit on the layer most of the members occupy, so a folded module does not jump planes.
      layer: majorityLayer(members),
      name: `${module || 'Ungrouped'} (${members.length})`,
      module: module || undefined,
      description: members.map((m) => m.name).slice(0, 12).join(', '),
      meta: { Collapsed: `${members.length} nodes` },
      implicit: true,
    })
  }

  return kept
}

function majorityLayer(nodes: GraphNode[]): Layer {
  const counts = new Map<Layer, number>()
  for (const node of nodes) counts.set(node.layer, (counts.get(node.layer) ?? 0) + 1)
  let best: Layer = nodes[0]!.layer
  let bestCount = -1
  for (const layer of LAYERS) {
    const count = counts.get(layer) ?? 0
    if (count > bestCount) {
      best = layer
      bestCount = count
    }
  }
  return best
}

/** Ids hidden because their module is folded. */
export function collapsedMemberIds(
  nodes: GraphNode[],
  collapsed: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>()
  if (collapsed.size === 0) return hidden
  for (const node of nodes) {
    if (collapsed.has(node.module ?? '')) hidden.add(node.id)
  }
  return hidden
}

export interface ConnectionGroup {
  kind: EdgeKind
  /** The node at the other end. */
  nodeId: string
  /** Names of the workflows that use this connection; empty for a declared dependency. */
  workflows: string[]
  /** Distinct guard conditions carried by any step along it. */
  conditions: string[]
  edgeIds: string[]
}

/**
 * One entry per connection rather than per edge.
 *
 * Two workflows that both begin "the visitor renders the login screen" produce two edges, and
 * a panel listing edges shows the same connection twice with no hint why. What a reader wants
 * is the connection once, and which flows run through it. That is also the more useful fact:
 * a connection several flows share is exactly the one to be careful changing.
 */
export function groupConnections(
  graph: Graph,
  edges: GraphEdge[],
  direction: 'in' | 'out',
): ConnectionGroup[] {
  const names = new Map(graph.workflows.map((workflow) => [workflow.id, workflow.name]))
  const groups = new Map<string, ConnectionGroup>()

  for (const edge of edges) {
    const other = direction === 'in' ? edge.from : edge.to
    const key = `${edge.kind}|${other}`
    let group = groups.get(key)
    if (!group) {
      group = { kind: edge.kind, nodeId: other, workflows: [], conditions: [], edgeIds: [] }
      groups.set(key, group)
    }
    group.edgeIds.push(edge.id)
    const workflow = edge.workflowId ? (names.get(edge.workflowId) ?? edge.workflowId) : null
    if (workflow && !group.workflows.includes(workflow)) group.workflows.push(workflow)
    if (edge.condition && !group.conditions.includes(edge.condition)) {
      group.conditions.push(edge.condition)
    }
  }

  return [...groups.values()]
}
