/**
 * Measures how much a layout moved between two runs.
 *
 * Deliberately knows nothing about the layout algorithm — it only assumes a map of node id
 * to a position with x/y/z. That keeps it usable as the instrument for judging any layout
 * design, and keeps the stability tests honest: "the map barely moved" becomes a number
 * rather than an impression.
 *
 * Distances are normalised by the diagonal of the *before* layout's bounding box, so a
 * result reads as "2% of the scene" and is independent of whatever world units the layout
 * happens to use.
 */

import type { Impact } from './scenarios.js'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type Positions = Readonly<Record<string, Vec3>>

export interface NodeMovement {
  id: string
  /** Distance in world units. */
  distance: number
  /** Distance as a fraction of the scene diagonal. */
  normalized: number
  from: Vec3
  to: Vec3
}

export interface LayoutDiff {
  /** Nodes present in both layouts. */
  surviving: number
  /** Surviving nodes whose position is bit-identical. */
  unchanged: number
  /** Surviving nodes that moved at all. */
  moved: number
  /** moved / surviving, or 0 when nothing survives. */
  fractionMoved: number
  /** Largest movement of any surviving node, normalised. */
  maxNormalized: number
  /** Mean movement across surviving nodes, normalised. */
  meanNormalized: number
  /** Ids only in the new layout. */
  added: string[]
  /** Ids only in the old layout. */
  removed: string[]
  /** Worst offenders, largest first. Capped for readable failure output. */
  worst: NodeMovement[]
  impact: Impact
}

export interface DiffOptions {
  /**
   * Below this normalised distance a movement is treated as noise rather than a move.
   * Zero by default: for a layout claiming determinism, exact equality is the bar.
   */
  epsilon?: number
  /** How many worst-offender entries to report. */
  worstCount?: number
}

/** A movement smaller than this fraction of the scene cannot be seen. */
const IMPERCEPTIBLE_MAX = 0.01
/** Above this fraction of the scene, a node has left its neighbourhood. */
const NEIGHBOURHOOD_MAX = 0.15
/** Share of the graph that may move and still count as a local change. */
const LOCALIZED_FRACTION = 0.05

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Diagonal of the axis-aligned bounding box; 1 when the layout is a single point. */
export function sceneDiagonal(positions: Positions): number {
  const values = Object.values(positions)
  if (values.length === 0) return 1

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const p of values) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  const diagonal = distance({ x: minX, y: minY, z: minZ }, { x: maxX, y: maxY, z: maxZ })
  return diagonal > 0 ? diagonal : 1
}

export function diffLayouts(
  before: Positions,
  after: Positions,
  options: DiffOptions = {},
): LayoutDiff {
  const { epsilon = 0, worstCount = 8 } = options
  const scale = sceneDiagonal(before)

  const movements: NodeMovement[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const id of Object.keys(before)) {
    if (!(id in after)) removed.push(id)
  }
  for (const id of Object.keys(after)) {
    if (!(id in before)) added.push(id)
  }

  let unchanged = 0
  let moved = 0
  let total = 0

  for (const [id, from] of Object.entries(before)) {
    const to = after[id]
    if (!to) continue
    const d = distance(from, to)
    const normalized = d / scale
    total += normalized

    if (d === 0) unchanged++
    else if (normalized > epsilon) {
      moved++
      movements.push({ id, distance: d, normalized, from, to })
    } else unchanged++
  }

  const surviving = unchanged + moved
  const maxNormalized = movements.reduce((max, m) => Math.max(max, m.normalized), 0)
  const meanNormalized = surviving > 0 ? total / surviving : 0
  const fractionMoved = surviving > 0 ? moved / surviving : 0

  return {
    surviving,
    unchanged,
    moved,
    fractionMoved,
    maxNormalized,
    meanNormalized,
    added: added.sort(),
    removed: removed.sort(),
    worst: movements.sort((a, b) => b.normalized - a.normalized).slice(0, worstCount),
    impact: classify(moved, surviving, maxNormalized),
  }
}

/**
 * "Imperceptible" needs both magnitude and locality: a single node shifting by a hair is
 * invisible, but every node shifting by the same hair is the whole map breathing, which a
 * viewer does notice. The locality test has a floor of one node — on a small graph a single
 * node is already a large *fraction*, and judging a 4-node fixture by percentage would call
 * every possible movement widespread.
 */
function classify(moved: number, surviving: number, maxNormalized: number): Impact {
  if (moved === 0) return 'none'
  const localized = moved <= Math.max(1, surviving * LOCALIZED_FRACTION)
  if (maxNormalized < IMPERCEPTIBLE_MAX && localized) return 'imperceptible'
  if (maxNormalized < NEIGHBOURHOOD_MAX) return 'same-neighbourhood'
  return 'arbitrary'
}

const SEVERITY: Record<Impact, number> = {
  none: 0,
  imperceptible: 1,
  'same-neighbourhood': 2,
  arbitrary: 3,
}

/** True when `actual` is no worse than `budget`. */
export function withinBudget(actual: Impact, budget: Impact): boolean {
  return SEVERITY[actual] <= SEVERITY[budget]
}

/** Readable one-liner plus offenders, for test failure messages. */
export function formatDiff(diff: LayoutDiff): string {
  const head =
    `impact=${diff.impact} moved=${diff.moved}/${diff.surviving} ` +
    `(${(diff.fractionMoved * 100).toFixed(1)}%) ` +
    `max=${(diff.maxNormalized * 100).toFixed(2)}% mean=${(diff.meanNormalized * 100).toFixed(2)}%` +
    (diff.added.length ? ` +${diff.added.length}` : '') +
    (diff.removed.length ? ` -${diff.removed.length}` : '')
  if (diff.worst.length === 0) return head
  const worst = diff.worst
    .map((m) => `    ${m.id}: ${(m.normalized * 100).toFixed(2)}% of scene`)
    .join('\n')
  return `${head}\n${worst}`
}
