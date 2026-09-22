import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import type { GraphNode } from '../../schema/graph.js'
import type { NodeKind } from '../../schema/kinds.js'
import type { LayoutResult, Vec3 } from '../../layout/types.js'
import type { Palette } from './palette.js'

const SIZE = 11

/**
 * Shape carries kind, colour carries layer.
 *
 * Two channels rather than one: colour alone fails for anyone with a colour vision
 * deficiency, and at a distance a silhouette reads before a hue does. Four groups is enough
 * to separate the things you actually navigate by — who, what decides, what stores.
 */
type Shape = 'box' | 'sphere' | 'octahedron' | 'cylinder'

function shapeOf(kind: NodeKind): Shape {
  switch (kind) {
    case 'actor':
      return 'sphere'
    case 'decision':
    case 'error':
      return 'octahedron'
    case 'entity':
    case 'store':
    case 'state':
      return 'cylinder'
    default:
      return 'box'
  }
}

/** Dim by desaturating toward the background rather than by opacity: instances in one
 *  group share a material, so per-instance transparency is not available. */
function dim(hex: string, dark: boolean): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const towards = dark ? 0 : 255
  const mix = (offset: number) => {
    const channel = parseInt(clean.slice(offset, offset + 2), 16)
    return Math.round(channel + (towards - channel) * 0.78)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${mix(0)}${mix(2)}${mix(4)}`
}

export interface Nodes3DProps {
  nodes: GraphNode[]
  layout: LayoutResult
  positions: Record<string, Vec3>
  palette: Palette
  selectedId: string | null
  hoveredId: string | null
  highlight: ReadonlySet<string> | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

export function Nodes3D(props: Nodes3DProps) {
  const { nodes, positions, palette, selectedId, hoveredId, highlight, onSelect, onHover } = props

  const groups = useMemo(() => {
    const byShape: Record<Shape, GraphNode[]> = {
      box: [], sphere: [], octahedron: [], cylinder: [],
    }
    for (const node of nodes) {
      if (positions[node.id]) byShape[shapeOf(node.kind)].push(node)
    }
    return byShape
  }, [nodes, positions])

  const colourOf = (node: GraphNode) => {
    const base = node.kind === 'error' ? palette.danger : palette.layer[node.layer]
    if (node.id === selectedId) return palette.accent
    if (highlight && !highlight.has(node.id)) return dim(base, palette.dark)
    return base
  }

  const scaleOf = (node: GraphNode) =>
    node.id === selectedId ? 1.45 : node.id === hoveredId ? 1.2 : 1

  const render = (shape: Shape, geometry: React.ReactNode) => {
    const members = groups[shape]
    if (members.length === 0) return null
    return (
      <Instances key={shape} limit={Math.max(members.length, 1)} range={members.length}>
        {geometry}
        <meshStandardMaterial roughness={0.55} metalness={0.05} />
        {members.map((node) => {
          const at = positions[node.id]!
          return (
            <Instance
              key={node.id}
              position={[at.x, at.y, at.z]}
              color={colourOf(node)}
              scale={scaleOf(node)}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(node.id === selectedId ? null : node.id)
              }}
              onPointerOver={(event) => {
                event.stopPropagation()
                onHover(node.id)
              }}
              onPointerOut={() => onHover(null)}
            />
          )
        })}
      </Instances>
    )
  }

  return (
    <group>
      {render('box', <boxGeometry args={[SIZE, SIZE * 0.62, SIZE]} />)}
      {render('sphere', <sphereGeometry args={[SIZE * 0.52, 20, 14]} />)}
      {render('octahedron', <octahedronGeometry args={[SIZE * 0.62, 0]} />)}
      {render('cylinder', <cylinderGeometry args={[SIZE * 0.46, SIZE * 0.46, SIZE * 0.5, 18]} />)}
    </group>
  )
}
