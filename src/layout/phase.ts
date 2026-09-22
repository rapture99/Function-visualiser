/**
 * X — the flow-phase column.
 *
 * X is the authored step index of the node's home workflow. That single decision is what
 * makes this a 3D sequence diagram rather than a box scatter: every workflow's own path is
 * strictly monotone left to right, one column per step, and since nodes occupy only
 * x in [PHASE_PITCH·k ± CELL/2] the gutter between columns is provably empty for edges.
 *
 * It is also the design's one real stability cost, and worth being clear about: inserting a
 * step mid-workflow renumbers the tail, so that contiguous run slides one column right. It is
 * a rigid single-axis translation that preserves order and spacing — the eye reads it as "the
 * flow got one step longer", which is what happened — but it is not free, and S2 measures it.
 */

import type { Graph, GraphNode } from '../schema/graph.js'
import { SHELF_GAP, SHELF_WIDTH } from './constants.js'
import { bitLength, cmpId } from './hash.js'

export interface PhaseResult {
  phase: Map<string, number>
  /** Workflow ids, most significant first. Index doubles as the edge lane number. */
  priority: string[]
  /** Home workflow per node, for the column ruler labels. */
  home: Map<string, string>
  maxPhase: number
}

/**
 * Workflows ranked by length bucket, then id.
 *
 * The bucket is the bit length of the step count, not the count itself, so a workflow has to
 * nearly DOUBLE in length before it can overtake another and re-home their shared nodes.
 * Ranking on the raw count would let a single added step reshuffle X for every node two
 * workflows have in common.
 */
export function workflowPriority(graph: Graph): string[] {
  return graph.workflows
    .map((w) => ({ id: w.id, bucket: bitLength(w.steps.length) }))
    .sort((a, b) => b.bucket - a.bucket || cmpId(a.id, b.id))
    .map((w) => w.id)
}

export function computePhases(graph: Graph, nodes: GraphNode[]): PhaseResult {
  const phase = new Map<string, number>()
  const home = new Map<string, string>()
  const priority = workflowPriority(graph)
  const byId = new Map(graph.workflows.map((w) => [w.id, w]))
  const present = new Set(nodes.map((n) => n.id))

  // 1. Workflow steps. Visiting workflows in priority order and only claiming unset nodes is
  //    exactly "the highest-priority workflow a node belongs to wins".
  for (const workflowId of priority) {
    const workflow = byId.get(workflowId)
    if (!workflow) continue
    for (const step of workflow.steps) {
      if (!present.has(step.nodeId) || phase.has(step.nodeId)) continue
      phase.set(step.nodeId, step.order)
      home.set(step.nodeId, workflowId)
    }
  }

  // 2. Direction-aware BFS for anything still unphased — nodes reachable only through
  //    `depends` edges, for example. Frontier order is (phase, id) so it never depends on
  //    array order.
  //
  //    Error nodes are held out of the BFS entirely and phased afterwards, in step 3. They
  //    must inherit their cause's column exactly, and a cause is not always a workflow step:
  //    in the sample, `email-provider` is reached only through a `Dependencies:` edge, so it
  //    has no phase until this BFS runs. Letting the BFS reach the error first would land it
  //    one column past its cause and turn the error edge into a diagonal.
  const errorNodes = new Set<string>()
  for (const workflow of graph.workflows) {
    for (const error of workflow.errors) errorNodes.add(error.errorNodeId)
  }

  const adjacency = buildAdjacency(graph, present)
  let frontier = [...phase.keys()].sort(
    (a, b) => phase.get(a)! - phase.get(b)! || cmpId(a, b),
  )

  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      const from = phase.get(id)!
      for (const link of adjacency.get(id) ?? []) {
        if (phase.has(link.other) || errorNodes.has(link.other)) continue
        phase.set(link.other, link.forward ? from + 1 : Math.max(1, from - 1))
        next.push(link.other)
      }
    }
    frontier = next.sort((a, b) => phase.get(a)! - phase.get(b)! || cmpId(a, b))
  }

  // 3. Error nodes take their cause's column, so the error edge is a pure vertical drop
  //    inside one column rather than a diagonal across the map.
  for (const workflowId of priority) {
    const workflow = byId.get(workflowId)
    if (!workflow) continue
    for (const error of workflow.errors) {
      if (!present.has(error.errorNodeId) || phase.has(error.errorNodeId)) continue
      const at = phase.get(error.atNodeId)
      if (at === undefined) continue
      phase.set(error.errorNodeId, at)
      home.set(error.errorNodeId, workflowId)
    }
  }

  // 4. Whatever remains is genuinely unattached. It gets a reserved shelf past the end of the
  //    map rather than being folded in, because pretending an orphan is part of a flow is
  //    exactly the kind of invented relationship the parser refuses to make.
  let maxPhase = 0
  for (const value of phase.values()) maxPhase = Math.max(maxPhase, value)

  const unattached = nodes
    .map((n) => n.id)
    .filter((id) => !phase.has(id))
    .sort(cmpId)

  unattached.forEach((id, index) => {
    phase.set(id, maxPhase + SHELF_GAP + (index % SHELF_WIDTH))
  })

  let finalMax = 0
  for (const value of phase.values()) finalMax = Math.max(finalMax, value)

  return { phase, priority, home, maxPhase: finalMax }
}

interface Link {
  other: string
  forward: boolean
}

function buildAdjacency(graph: Graph, present: Set<string>): Map<string, Link[]> {
  const adjacency = new Map<string, Link[]>()
  const add = (from: string, link: Link) => {
    const list = adjacency.get(from)
    if (list) list.push(link)
    else adjacency.set(from, [link])
  }

  const edges = [...graph.edges]
    .filter((e) => e.kind !== 'contains' && present.has(e.from) && present.has(e.to))
    .sort((a, b) => cmpId(a.id, b.id))

  for (const edge of edges) {
    add(edge.from, { other: edge.to, forward: true })
    add(edge.to, { other: edge.from, forward: false })
  }
  return adjacency
}
