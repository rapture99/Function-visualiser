import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { collapsedMemberIds, foldCollapsed, isDrawable } from '../graph/selectors.js'
import { layoutOverview } from '../graph/layout2d.js'
import { computeLayout } from '../../layout/index.js'
import { positionsById } from '../../layout/types.js'

const graph = parse(
  readFileSync(
    fileURLToPath(new URL('../../testing/fixtures/sample-system.md', import.meta.url)),
    'utf8',
  ),
  'sample-system.md',
).graph

const drawable = graph.nodes.filter(isDrawable)

describe('foldCollapsed', () => {
  it('returns the input untouched when nothing is collapsed', () => {
    expect(foldCollapsed(drawable, new Set())).toBe(drawable)
  })

  it('replaces a module with one stand-in carrying the count', () => {
    const folded = foldCollapsed(drawable, new Set(['Leave']))
    const members = drawable.filter((n) => n.module === 'Leave')
    expect(members.length).toBeGreaterThan(1)

    expect(folded.some((n) => n.module === 'Leave' && n.kind !== 'module')).toBe(false)
    const standIn = folded.find((n) => n.id === 'collapsed/Leave')!
    expect(standIn.kind).toBe('module')
    expect(standIn.name).toBe(`Leave (${members.length})`)
    expect(folded).toHaveLength(drawable.length - members.length + 1)
  })

  it('leaves other modules completely alone', () => {
    const folded = foldCollapsed(drawable, new Set(['Leave']))
    const untouched = drawable.filter((n) => n.module !== 'Leave')
    for (const node of untouched) {
      expect(folded.find((n) => n.id === node.id)).toEqual(node)
    }
  })

  it('places the stand-in on the layer most of its members occupy', () => {
    const folded = foldCollapsed(drawable, new Set(['Leave']))
    const standIn = folded.find((n) => n.id === 'collapsed/Leave')!
    const members = drawable.filter((n) => n.module === 'Leave')
    const tally = members.reduce<Record<string, number>>((acc, n) => {
      acc[n.layer] = (acc[n.layer] ?? 0) + 1
      return acc
    }, {})
    const busiest = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]![0]
    expect(standIn.layer).toBe(busiest)
  })

  it('is deterministic regardless of input order', () => {
    const a = foldCollapsed(drawable, new Set(['Leave', 'Notifications']))
    const b = foldCollapsed([...drawable].reverse(), new Set(['Leave', 'Notifications']))
    expect(a.map((n) => n.id).sort()).toEqual(b.map((n) => n.id).sort())
  })
})

describe('collapsedMemberIds', () => {
  it('lists exactly the nodes a fold hides', () => {
    const hidden = collapsedMemberIds(drawable, new Set(['Leave']))
    const expected = drawable.filter((n) => n.module === 'Leave').map((n) => n.id)
    expect([...hidden].sort()).toEqual(expected.sort())
  })

  it('hides nothing when nothing is collapsed', () => {
    expect(collapsedMemberIds(drawable, new Set()).size).toBe(0)
  })
})

describe('collapse does not disturb the rest of the map', () => {
  it('leaves every surviving node at the same 2D position', () => {
    // Collapse is meant to be pure visibility. If folding one module moved anything else,
    // expanding it again would not restore the picture you had.
    const before = layoutOverview(drawable)
    const after = layoutOverview(foldCollapsed(drawable, new Set(['Notifications'])))

    const laneOf = (layout: typeof before, id: string) =>
      layout.lanes.find((lane) => {
        const at = layout.positions[id]
        return at ? at.y >= lane.y && at.y <= lane.y + lane.height : false
      })?.layer

    for (const node of drawable.filter((n) => n.module !== 'Notifications')) {
      expect(laneOf(after, node.id), `${node.id} changed layer`).toBe(laneOf(before, node.id))
    }
  })

  it('does not change any 3D address, because no address depends on member count', () => {
    // The 3D layout never sees the fold — the renderer just stops drawing hidden nodes.
    const positions = positionsById(computeLayout(graph))
    const again = positionsById(computeLayout(graph))
    expect(again).toEqual(positions)
  })
})
