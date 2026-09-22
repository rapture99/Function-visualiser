import dagre from '@dagrejs/dagre'
import type { GraphEdge, GraphNode } from '../../schema/graph.js'
import { LAYERS, type Layer } from '../../schema/kinds.js'

export const NODE_W = 200
export const NODE_H = 48

export interface Point {
  x: number
  y: number
}

export interface Layout {
  /** Node centres. */
  positions: Record<string, Point>
  width: number
  height: number
  /** Routed edge polylines from dagre, keyed `from|to`. Absent for the overview. */
  edgePaths?: Record<string, Point[]>
}

export const edgeKey = (from: string, to: string) => `${from}|${to}`

export interface GroupBox {
  key: string
  label: string
  layer: Layer
  x: number
  y: number
  width: number
  height: number
}

export interface LaneBox {
  layer: Layer
  y: number
  height: number
}

export interface OverviewLayout extends Layout {
  groups: GroupBox[]
  lanes: LaneBox[]
}

/**
 * Workflow layout: a directed acyclic-ish path, so Sugiyama (via dagre) is exactly right.
 * Top-to-bottom reads as a sequence, which is the whole point of this view — you are
 * following what happens, in order, not exploring a space.
 */
export function layoutWorkflow(nodes: GraphNode[], edges: GraphEdge[]): Layout {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 44, ranksep: 64, marginx: 48, marginy: 48 })
  g.setDefaultEdgeLabel(() => ({}))

  const present = new Set(nodes.map((n) => n.id))
  for (const node of nodes) g.setNode(node.id, { width: NODE_W, height: NODE_H })
  for (const edge of edges) {
    if (present.has(edge.from) && present.has(edge.to)) g.setEdge(edge.from, edge.to)
  }

  dagre.layout(g)

  const positions: Record<string, Point> = {}
  for (const id of g.nodes()) {
    const laid = g.node(id) as { x: number; y: number } | undefined
    if (laid) positions[id] = { x: laid.x, y: laid.y }
  }

  // dagre routes edges around intervening nodes; using its points instead of a straight
  // line between centres is the difference between a readable flow and a scribble.
  const edgePaths: Record<string, Point[]> = {}
  for (const e of g.edges()) {
    const routed = g.edge(e) as { points?: Point[] } | undefined
    if (routed?.points?.length) edgePaths[edgeKey(e.v, e.w)] = routed.points
  }

  const graphSize = g.graph() as { width?: number; height?: number }
  return {
    positions,
    edgePaths,
    width: graphSize.width ?? NODE_W,
    height: graphSize.height ?? NODE_H,
  }
}

const LANE_PAD_TOP = 34
const LANE_GAP = 28
const GROUP_GAP = 34
const GROUP_PAD = 14
const COL_GAP = 20
const ROW_GAP = 16
const MAX_COLS = 5
const MARGIN = 40

/**
 * Overview layout: horizontal lanes, one per layer, with modules as labelled blocks inside.
 *
 * Deliberately NOT a force-directed graph. At this zoom level the useful question is "what
 * exists and where does it sit", and a lane diagram answers that at a glance where a
 * hairball does not. Connections are drawn on demand, when a node is selected.
 *
 * Fully deterministic: groups are ordered by module name and nodes by id, so the map does
 * not reshuffle when the document is edited.
 */
export function layoutOverview(nodes: GraphNode[]): OverviewLayout {
  const positions: Record<string, Point> = {}
  const groups: GroupBox[] = []
  const lanes: LaneBox[] = []

  const byLayer = new Map<Layer, GraphNode[]>()
  for (const node of nodes) {
    const list = byLayer.get(node.layer)
    if (list) list.push(node)
    else byLayer.set(node.layer, [node])
  }

  let y = MARGIN
  let maxX = 0

  for (const layer of LAYERS) {
    const inLayer = byLayer.get(layer)
    if (!inLayer || inLayer.length === 0) continue

    const byModule = new Map<string, GraphNode[]>()
    for (const node of inLayer) {
      const key = node.module ?? ''
      const list = byModule.get(key)
      if (list) list.push(node)
      else byModule.set(key, [node])
    }

    // Named modules first, alphabetically; ungrouped nodes last. Stable regardless of the
    // order the document happened to declare things in.
    const moduleKeys = [...byModule.keys()].sort((a, b) => {
      if (a === '') return 1
      if (b === '') return -1
      return a < b ? -1 : a > b ? 1 : 0
    })

    let x = MARGIN
    let laneRows = 1

    for (const moduleKey of moduleKeys) {
      const members = [...byModule.get(moduleKey)!].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      )
      const cols = Math.min(MAX_COLS, members.length)
      const rows = Math.ceil(members.length / cols)
      laneRows = Math.max(laneRows, rows)

      const innerW = cols * NODE_W + (cols - 1) * COL_GAP
      const innerH = rows * NODE_H + (rows - 1) * ROW_GAP

      members.forEach((node, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)
        positions[node.id] = {
          x: x + GROUP_PAD + col * (NODE_W + COL_GAP) + NODE_W / 2,
          y: y + LANE_PAD_TOP + GROUP_PAD + row * (NODE_H + ROW_GAP) + NODE_H / 2,
        }
      })

      groups.push({
        key: `${layer}/${moduleKey || 'ungrouped'}`,
        label: moduleKey,
        layer,
        x,
        y: y + LANE_PAD_TOP,
        width: innerW + GROUP_PAD * 2,
        height: innerH + GROUP_PAD * 2,
      })

      x += innerW + GROUP_PAD * 2 + GROUP_GAP
    }

    maxX = Math.max(maxX, x - GROUP_GAP)
    const laneHeight = LANE_PAD_TOP + laneRows * NODE_H + (laneRows - 1) * ROW_GAP + GROUP_PAD * 2
    lanes.push({ layer, y, height: laneHeight })
    y += laneHeight + LANE_GAP
  }

  return {
    positions,
    groups,
    lanes,
    width: maxX + MARGIN,
    height: y - LANE_GAP + MARGIN,
  }
}
