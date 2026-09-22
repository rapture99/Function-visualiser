import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import type { PerspectiveCamera } from 'three'
import type { Graph, GraphNode } from '../../schema/graph.js'
import type { Bounds, LayoutResult } from '../../layout/types.js'
import { positionsById } from '../../layout/types.js'
import { isDrawable, neighbourIds, overviewEdges, workflowView } from '../graph/selectors.js'
import { useLayout3D } from './useLayout3D.js'
import { usePalette } from './palette.js'
import { Nodes3D } from './Nodes3D.js'
import { Edges3D } from './Edges3D.js'
import { Frames3D } from './Frames3D.js'

/** Above this many nodes, labelling everything is noise; hover and selection carry it. */
const LABEL_ALL_BELOW = 70

/** A document this sparse shows every connection, or a scanner draft would look empty. */
const JUMPS_ALWAYS_BELOW = 8

type V3 = { x: number; y: number; z: number }

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const unit = (a: V3): V3 => {
  const length = Math.sqrt(dot(a, a)) || 1
  return { x: a.x / length, y: a.y / length, z: a.z / length }
}

/** The viewing angle: above, in front and a little to the right, so every layer shows. */
const VIEW_DIRECTION = unit({ x: 0.5, y: 0.45, z: 0.8 })

/**
 * How far back the camera must sit to see every corner of a box.
 *
 * Each corner is projected into the camera's frame; the distance is whatever keeps the worst
 * one inside the frustum, horizontally and vertically, for this canvas's aspect ratio. The
 * first version used a fixed multiple of the box's largest side, which ignores the field of
 * view and the canvas shape entirely — so once the playback bar made the canvas shorter, the
 * bottom of every workflow ran off the edge.
 */
export function fitDistance(bounds: Bounds, verticalFovDegrees: number, aspect: number): number {
  const centre = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  }
  const forward = { x: -VIEW_DIRECTION.x, y: -VIEW_DIRECTION.y, z: -VIEW_DIRECTION.z }
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }))
  const up = cross(right, forward)

  const tanV = Math.tan(((verticalFovDegrees * Math.PI) / 180) / 2)
  const tanH = tanV * Math.max(aspect, 0.1)

  let distance = 1
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const offset = sub({ x, y, z }, centre)
        // A corner nearer the camera needs more room, one further away less.
        const towardCamera = dot(offset, VIEW_DIRECTION)
        distance = Math.max(
          distance,
          towardCamera + Math.abs(dot(offset, right)) / tanH,
          towardCamera + Math.abs(dot(offset, up)) / tanV,
        )
      }
    }
  }
  // Room for the labels that sit above nodes, and a margin so nothing kisses the edge.
  return distance * 1.08 + 40
}

function CameraFit({ bounds, fitKey }: { bounds: Bounds; fitKey: string }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const size = useThree((state) => state.size)
  const controls = useThree((state) => state.controls) as
    | { target: { set: (x: number, y: number, z: number) => void }; update: () => void }
    | null

  useEffect(() => {
    const centre = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    }
    const distance = fitDistance(bounds, camera.fov ?? 45, size.width / Math.max(1, size.height))
    camera.position.set(
      centre.x + VIEW_DIRECTION.x * distance,
      centre.y + VIEW_DIRECTION.y * distance,
      centre.z + VIEW_DIRECTION.z * distance,
    )
    camera.near = 1
    camera.far = distance * 8
    camera.updateProjectionMatrix()
    controls?.target.set(centre.x, centre.y, centre.z)
    controls?.update()
    // Refit when the document or workflow changes (fitKey) and when the canvas changes shape:
    // opening a workflow brings up the playback bar, which shortens the canvas a moment after
    // the fit key changes. Bounds alone are deliberately excluded, so an incidental recompute
    // never yanks the camera away from where the user put it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.width, size.height, camera, controls])

  return null
}

/**
 * Eases the orbit target toward the node under the playhead.
 *
 * Only the target moves, never the camera position — the viewer keeps whatever angle and
 * distance they chose, and the scene pans under them. Cutting straight to each step makes
 * the flow impossible to follow; this is the one place the extra motion earns its keep.
 */
function FollowTarget({ target }: { target?: { x: number; y: number; z: number } }) {
  const controls = useThree((state) => state.controls) as
    | { target: { x: number; y: number; z: number }; update: () => void }
    | null
  const camera = useThree((state) => state.camera)
  const offset = useRef<{ x: number; y: number; z: number } | null>(null)

  useFrame((_, delta) => {
    if (!target || !controls) return
    if (!offset.current) {
      offset.current = {
        x: camera.position.x - controls.target.x,
        y: camera.position.y - controls.target.y,
        z: camera.position.z - controls.target.z,
      }
    }
    // Exponential approach, framerate independent.
    const k = 1 - Math.exp(-6 * delta)
    controls.target.x += (target.x - controls.target.x) * k
    controls.target.y += (target.y - controls.target.y) * k
    controls.target.z += (target.z - controls.target.z) * k
    camera.position.set(
      controls.target.x + offset.current.x,
      controls.target.y + offset.current.y,
      controls.target.z + offset.current.z,
    )
    controls.update()
  })

  useEffect(() => {
    // Recapture the framing whenever following stops, so a manual orbit is not fought.
    if (!target) offset.current = null
  }, [target])

  return null
}

export interface Scene3DProps {
  graph: Graph
  activeWorkflow: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  visibleIds: ReadonlySet<string>
  /** Module names folded away; each gets one stand-in at its district anchor. */
  collapsed: ReadonlySet<string>
  /** Node the camera should ease toward — the playback playhead. */
  followId?: string | null
  /** Overrides the internally derived emphasis, so playback can drive it. */
  highlight?: ReadonlySet<string> | null
  fitKey: string
}

export function Scene3D(props: Scene3DProps) {
  const { graph, activeWorkflow, selectedId, onSelect, visibleIds, collapsed, followId, fitKey } = props
  const layout = useLayout3D(graph)
  const palette = usePalette()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const positions = useMemo(() => (layout ? positionsById(layout) : {}), [layout])

  const nodes = useMemo(
    () => graph.nodes.filter((n) => isDrawable(n) && visibleIds.has(n.id) && positions[n.id]),
    [graph.nodes, visibleIds, positions],
  )

  // The whole workflow when one is active; otherwise the same rule the 2D overview uses —
  // draw the connections when there are few enough to stay readable, and fall back to
  // selection-only on a densely connected document.
  const edges = useMemo(() => {
    if (activeWorkflow) return workflowView(graph, activeWorkflow)?.edges ?? []
    return overviewEdges(graph, selectedId)
  }, [graph, activeWorkflow, selectedId])

  const highlight = useMemo(() => {
    if (props.highlight !== undefined) return props.highlight
    if (!selectedId) return null
    return neighbourIds(graph, selectedId)
  }, [graph, selectedId, props.highlight])

  const labelled = useMemo(() => {
    if (nodes.length <= LABEL_ALL_BELOW) return nodes
    const wanted = new Set<string>()
    if (selectedId) wanted.add(selectedId)
    if (hoveredId) wanted.add(hoveredId)
    if (activeWorkflow) {
      for (const step of graph.workflows.find((w) => w.id === activeWorkflow)?.steps ?? []) {
        wanted.add(step.nodeId)
      }
    }
    return nodes.filter((n) => wanted.has(n.id))
  }, [nodes, selectedId, hoveredId, activeWorkflow, graph.workflows])

  /**
   * What the camera frames. The whole map in the overview, so its shape stays put while you
   * explore; only the open workflow's nodes otherwise, because a flow framed as a speck in one
   * corner of the full map is a flow you cannot read.
   */
  const fitBounds = useMemo<Bounds | null>(() => {
    if (!layout) return null
    if (!activeWorkflow || nodes.length === 0) return layout.bounds
    const min = { x: Infinity, y: Infinity, z: Infinity }
    const max = { x: -Infinity, y: -Infinity, z: -Infinity }
    for (const node of nodes) {
      const at = positions[node.id]
      if (!at) continue
      min.x = Math.min(min.x, at.x)
      min.y = Math.min(min.y, at.y)
      min.z = Math.min(min.z, at.z)
      max.x = Math.max(max.x, at.x)
      max.y = Math.max(max.y, at.y)
      max.z = Math.max(max.z, at.z)
    }
    return Number.isFinite(min.x) ? { min, max } : layout.bounds
  }, [layout, activeWorkflow, nodes, positions])

  if (!layout) {
    return <div className="centre">Computing layout…</div>
  }

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: 45, position: [400, 400, 700] }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={palette.dark ? 1.25 : 1.55} />
      <directionalLight position={[400, 700, 500]} intensity={palette.dark ? 1.5 : 2.1} />
      <directionalLight position={[-400, 200, -300]} intensity={0.5} />

      <CameraFit bounds={fitBounds ?? layout.bounds} fitKey={fitKey} />
      <FollowTarget target={followId ? positions[followId] : undefined} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxDistance={12000} />

      <Frames3D layout={layout} palette={palette} />

      <Nodes3D
        nodes={nodes}
        layout={layout}
        positions={positions}
        palette={palette}
        selectedId={selectedId}
        hoveredId={hoveredId}
        highlight={highlight}
        onSelect={onSelect}
        onHover={setHoveredId}
      />

      <Edges3D
        edges={edges}
        layout={layout}
        positions={positions}
        palette={palette}
        showJumps={Boolean(activeWorkflow || selectedId) || edges.length <= JUMPS_ALWAYS_BELOW}
      />

      {/* A folded module leaves a marker where it lives, so the space it occupies stays
          legible and clicking it is an obvious way back. Collapse changes no coordinate —
          the layout never sees it — so expanding restores the map exactly. */}
      {layout.modules
        .filter((district) => collapsed.has(district.name))
        .map((district) => (
          <mesh
            key={district.key}
            position={[district.anchor.x, district.anchor.y, district.anchor.z]}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(null)
            }}
          >
            <boxGeometry args={[26, 26, 26]} />
            <meshStandardMaterial
              color={palette.faint}
              transparent
              opacity={0.55}
              roughness={0.6}
            />
          </mesh>
        ))}

      {layout.modules
        .filter((district) => collapsed.has(district.name))
        .map((district) => (
          <Html
            key={`${district.key}-label`}
            position={[district.anchor.x, district.anchor.y + 22, district.anchor.z]}
            center
            distanceFactor={430}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div className="scene-node-label">
              {district.name} ({district.memberIds.length})
            </div>
          </Html>
        ))}

      {labelled.map((node: GraphNode) => {
        const at = positions[node.id]!
        const muted = highlight ? !highlight.has(node.id) : false
        return (
          <Html
            key={node.id}
            position={[at.x, at.y + 12, at.z]}
            center
            distanceFactor={430}
            zIndexRange={[20, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={`scene-node-label${node.id === selectedId ? ' selected' : ''}${muted ? ' muted' : ''}`}
            >
              {node.name}
            </div>
          </Html>
        )
      })}
    </Canvas>
  )
}
