import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { GraphEdge, GraphNode } from '../../schema/graph.js'
import type { EdgeKind } from '../../schema/kinds.js'
import {
  NODE_H,
  NODE_W,
  edgeKey,
  type GroupBox,
  type LaneBox,
  type Point,
} from '../graph/layout2d.js'

const LAYER_LABEL: Record<string, string> = {
  actor: 'Actors',
  interface: 'Interface',
  logic: 'Logic',
  data: 'Data',
  external: 'External',
}

/** Dashed for reads, thick for writes, dotted for plain sequence — legible without a legend. */
const EDGE_STYLE: Record<EdgeKind, { dash?: string; width?: number; danger?: boolean }> = {
  next: { dash: '2 4' },
  calls: {},
  renders: {},
  reads: { dash: '5 4' },
  writes: { width: 2.4 },
  emits: { dash: '7 3' },
  returns: {},
  depends: { dash: '3 5' },
  contains: {},
  error: { dash: '4 3', danger: true },
}

export interface CanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  positions: Record<string, Point>
  edgePaths?: Record<string, Point[]>
  width: number
  height: number
  groups?: GroupBox[]
  lanes?: LaneBox[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** When set, everything outside the set is dimmed rather than hidden. */
  highlight?: ReadonlySet<string> | null
  /** Step numbers to badge onto nodes, for workflow view. */
  steps?: Map<string, number[]>
  /** Refit the view when this value changes. */
  fitKey: string
  hint?: string
}

interface Transform {
  x: number
  y: number
  k: number
}

/** Smooth a routed polyline into a path, rounding the corners dagre leaves square. */
function pathFrom(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  }
  let d = `M${points[0]!.x},${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i]!
    const next = points[i + 1]!
    d += ` Q${current.x},${current.y} ${(current.x + next.x) / 2},${(current.y + next.y) / 2}`
  }
  const last = points[points.length - 1]!
  d += ` L${last.x},${last.y}`
  return d
}

/** Fallback when dagre gave no route: a vertical-ish bezier between two node centres. */
function bezierBetween(from: Point, to: Point): string {
  const dy = Math.abs(to.y - from.y)
  const bend = Math.max(24, dy * 0.4)
  const sy = from.y + (to.y >= from.y ? NODE_H / 2 : -NODE_H / 2)
  const ty = to.y + (to.y >= from.y ? -NODE_H / 2 : NODE_H / 2)
  return `M${from.x},${sy} C${from.x},${sy + (to.y >= from.y ? bend : -bend)} ${to.x},${ty - (to.y >= from.y ? bend : -bend)} ${to.x},${ty}`
}

export function GraphCanvas(props: CanvasProps) {
  const {
    nodes, edges, positions, edgePaths, width, height,
    groups, lanes, selectedId, onSelect, highlight, steps, fitKey, hint,
  } = props

  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const [dragging, setDragging] = useState(false)
  const dragFrom = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const fit = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    const k = Math.min(box.width / width, box.height / height, 1)
    setTransform({ x: (box.width - width * k) / 2, y: (box.height - height * k) / 2, k })
  }, [width, height])

  useEffect(fit, [fit, fitKey])

  useEffect(() => {
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const px = event.clientX - box.left
    const py = event.clientY - box.top
    setTransform((t) => {
      const k = Math.min(2.5, Math.max(0.08, t.k * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
      // Keep the point under the cursor fixed while zooming.
      return { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k }
    })
  }

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    dragFrom.current = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = dragFrom.current
    if (!start) return
    setTransform((t) => ({
      ...t,
      x: start.tx + (event.clientX - start.x),
      y: start.ty + (event.clientY - start.y),
    }))
  }

  const endDrag = () => {
    dragFrom.current = null
    setDragging(false)
  }

  const drawn = useMemo(() => nodes.filter((n) => positions[n.id]), [nodes, positions])
  const visible = useMemo(() => new Set(drawn.map((n) => n.id)), [drawn])

  return (
    <>
      <svg
        ref={svgRef}
        className={`canvas${dragging ? ' dragging' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelect(null)
        }}
        role="application"
        aria-label="Functionality graph"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--text-faint)" />
          </marker>
          <marker id="arrow-danger" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--danger)" />
          </marker>
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {lanes?.map((lane) => (
            <g key={lane.layer}>
              <rect
                x={8}
                y={lane.y}
                width={Math.max(width - 16, 0)}
                height={lane.height}
                fill="var(--grid)"
                rx={10}
                opacity={0.55}
              />
              <text
                x={20}
                y={lane.y + 21}
                className="lane-label"
                fill={`var(--layer-${lane.layer})`}
              >
                {LAYER_LABEL[lane.layer] ?? lane.layer}
              </text>
            </g>
          ))}

          {groups?.map((group) =>
            group.label ? (
              <g key={group.key}>
                <rect
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height={group.height}
                  fill="none"
                  stroke="var(--border)"
                  strokeDasharray="3 4"
                  rx={8}
                />
                <text x={group.x + 4} y={group.y - 4} className="group-label">
                  {group.label}
                </text>
              </g>
            ) : null,
          )}

          {edges.map((edge) => {
            if (edge.kind === 'contains') return null
            const from = positions[edge.from]
            const to = positions[edge.to]
            if (!from || !to || !visible.has(edge.from) || !visible.has(edge.to)) return null

            const style = EDGE_STYLE[edge.kind] ?? {}
            const routed = edgePaths?.[edgeKey(edge.from, edge.to)]
            const dimmed = highlight ? !highlight.has(edge.from) || !highlight.has(edge.to) : false

            return (
              <path
                key={edge.id}
                className={`edge${dimmed ? ' dim' : ''}`}
                d={routed ? pathFrom(routed) : bezierBetween(from, to)}
                stroke={style.danger ? 'var(--danger)' : 'var(--text-faint)'}
                strokeWidth={style.width ?? 1.6}
                strokeDasharray={style.dash}
                markerEnd={style.danger ? 'url(#arrow-danger)' : 'url(#arrow)'}
              >
                <title>{`${edge.from} —${edge.kind}→ ${edge.to}${edge.condition ? ` (when ${edge.condition})` : ''}${edge.label ? `: ${edge.label}` : ''}`}</title>
              </path>
            )
          })}

          {drawn.map((node) => {
            const at = positions[node.id]!
            const dimmed = highlight ? !highlight.has(node.id) : false
            const selected = node.id === selectedId
            const colour = `var(--layer-${node.layer})`
            const order = steps?.get(node.id)

            return (
              <g
                key={node.id}
                className={`node${dimmed ? ' dim' : ''}`}
                transform={`translate(${at.x - NODE_W / 2},${at.y - NODE_H / 2})`}
                tabIndex={0}
                role="button"
                aria-pressed={selected}
                aria-label={`${node.name}, ${node.kind}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelect(selected ? null : node.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(selected ? null : node.id)
                  }
                }}
              >
                <rect
                  className="node-box"
                  width={NODE_W}
                  height={NODE_H}
                  fill="var(--panel)"
                  stroke={selected ? 'var(--accent)' : colour}
                  strokeWidth={selected ? 2.6 : 1.5}
                />
                <rect width={4} height={NODE_H} fill={colour} rx={2} />
                {node.kind === 'module' ? (
                  <rect
                    x={6}
                    y={-4}
                    width={NODE_W - 12}
                    height={NODE_H}
                    rx={7}
                    fill="none"
                    stroke={colour}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                ) : null}
                <text className="node-title" x={13} y={20}>
                  {node.name.length > 26 ? `${node.name.slice(0, 25)}…` : node.name}
                </text>
                <text className="node-sub" x={13} y={35}>
                  {node.kind === 'module' ? 'collapsed — click the tree to expand' : node.kind}
                  {node.kind !== 'module' && node.module ? ` · ${node.module}` : ''}
                </text>
                {order && order.length > 0 ? (
                  <>
                    <circle cx={NODE_W - 15} cy={15} r={9.5} fill={colour} />
                    <text
                      className="step-badge"
                      x={NODE_W - 15}
                      y={18.5}
                      textAnchor="middle"
                    >
                      {order.join(',')}
                    </text>
                  </>
                ) : null}
                <title>{node.description ?? node.id}</title>
              </g>
            )
          })}
        </g>
      </svg>

      {hint ? <div className="hint">{hint}</div> : null}
      <div className="zoom">
        <button type="button" onClick={() => setTransform((t) => ({ ...t, k: t.k * 1.2 }))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setTransform((t) => ({ ...t, k: t.k / 1.2 }))} aria-label="Zoom out">−</button>
        <button type="button" onClick={fit} aria-label="Fit to view">⤢</button>
      </div>
    </>
  )
}
