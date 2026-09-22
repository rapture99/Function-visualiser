import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { GraphEdge } from '../../schema/graph.js'
import type { LayoutResult, Vec3 } from '../../layout/types.js'
import type { Palette } from './palette.js'

const OVERPASS_Y = 340

/**
 * Edges are drawn on demand — for the active workflow, or for the selected node — never all
 * at once. At this zoom the useful question is "what exists and where does it sit"; a
 * hairball answers it worse than an empty map plus a reveal on selection.
 *
 * Two classes. A workflow's own steps land in adjacent columns, and since nodes occupy only
 * the middle of each column the gutter between them is provably clear, so those run straight.
 * Anything that jumps columns or crosses districts is lifted over the top of the scene
 * instead: an overpass cannot be occluded by geometry, because nothing exists above the actor
 * plane, and it reads as what it actually is — a jump rather than a step.
 */
function sampleQuadratic(from: Vec3, control: Vec3, to: Vec3, steps: number): [number, number, number][] {
  const points: [number, number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const inverse = 1 - t
    const a = inverse * inverse
    const b = 2 * inverse * t
    const c = t * t
    points.push([
      a * from.x + b * control.x + c * to.x,
      a * from.y + b * control.y + c * to.y,
      a * from.z + b * control.z + c * to.z,
    ])
  }
  return points
}

export interface Edges3DProps {
  edges: GraphEdge[]
  layout: LayoutResult
  positions: Record<string, Vec3>
  palette: Palette
  emphasise?: ReadonlySet<string> | null
  /**
   * Whether to draw jumps — edges between distant columns or different districts, which render
   * as tall arcs over the scene. In an overview they are mostly noise: a dozen arcs crossing
   * the map say "things are connected" and nothing about which. They earn their place once a
   * node is selected or a workflow is open, because then every arc is one you asked about.
   */
  showJumps?: boolean
}

export function Edges3D({ edges, layout, positions, palette, emphasise, showJumps = true }: Edges3DProps) {
  const phaseOf = useMemo(() => {
    const map = new Map<string, number>()
    layout.nodeIds.forEach((id, index) => map.set(id, layout.slots[index * 4]!))
    return map
  }, [layout])

  const drawn = useMemo(
    () =>
      edges
        .filter((edge) => edge.kind !== 'contains' && positions[edge.from] && positions[edge.to])
        .map((edge) => {
          const from = positions[edge.from]!
          const to = positions[edge.to]!
          const columnGap = Math.abs((phaseOf.get(edge.to) ?? 0) - (phaseOf.get(edge.from) ?? 0))
          const districtGap = Math.abs(to.z - from.z)
          const isJump = columnGap > 1 || districtGap > 48

          const points = isJump
            ? sampleQuadratic(
                from,
                {
                  x: (from.x + to.x) / 2,
                  y: OVERPASS_Y + Math.min(columnGap, 8) * 14,
                  z: (from.z + to.z) / 2,
                },
                to,
                24,
              )
            : sampleQuadratic(
                from,
                { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 6, z: (from.z + to.z) / 2 },
                to,
                10,
              )

          return { edge, points, isJump }
        }),
    [edges, positions, phaseOf],
  )

  return (
    <group>
      {drawn.filter(({ isJump }) => showJumps || !isJump).map(({ edge, points, isJump }) => {
        const active = !emphasise || emphasise.has(edge.id)
        const colour =
          edge.kind === 'error' ? palette.danger : isJump ? palette.faint : palette.accent
        return (
          <Line
            key={edge.id}
            points={points}
            color={colour}
            lineWidth={edge.kind === 'writes' ? 2.4 : 1.5}
            dashed={edge.kind === 'reads' || edge.kind === 'error' || edge.kind === 'depends'}
            dashScale={edge.kind === 'error' ? 0.5 : 0.25}
            transparent
            opacity={active ? (isJump ? 0.55 : 0.95) : 0.12}
          />
        )
      })}
    </group>
  )
}
