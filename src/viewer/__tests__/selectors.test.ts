import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { OVERVIEW_EDGE_LIMIT, overviewEdges } from '../graph/selectors.js'
import type { Graph } from '../../schema/graph.js'

const load = (name: string): Graph =>
  parse(
    readFileSync(fileURLToPath(new URL(`../../testing/fixtures/${name}`, import.meta.url)), 'utf8'),
    name,
  ).graph

const sample = load('sample-system.md')

describe('overviewEdges', () => {
  it('shows the real connections on a document small enough to stay readable', () => {
    const edges = overviewEdges(sample, null)
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every((e) => e.kind !== 'contains')).toBe(true)
  })

  it('never draws containment, which is the group box rather than a line', () => {
    expect(overviewEdges(sample, null).some((e) => e.kind === 'contains')).toBe(false)
  })

  it('narrows to just that node once something is selected', () => {
    const edges = overviewEdges(sample, 'leave-service')
    expect(edges.length).toBeGreaterThan(0)
    expect(edges.every((e) => e.from === 'leave-service' || e.to === 'leave-service')).toBe(true)
  })

  it('falls back to selection-only on a densely connected document', () => {
    // Above the limit an all-edges overview is the hairball the view exists to avoid.
    const dense: Graph = {
      ...sample,
      edges: Array.from({ length: OVERVIEW_EDGE_LIMIT + 1 }, (_, i) => ({
        ...sample.edges.find((e) => e.kind !== 'contains')!,
        id: `synthetic-${i}`,
      })),
    }
    expect(overviewEdges(dense, null)).toHaveLength(0)
    expect(overviewEdges(dense, 'leave-service').length).toBeGreaterThan(0)
  })

  it('shows the few connections a scanner draft has, rather than nothing', () => {
    // The case that motivated this: 207 nodes, 4 real edges, everything else containment.
    const scannerish: Graph = {
      ...sample,
      workflows: [],
      edges: sample.edges.filter((e) => e.kind === 'contains' || e.kind === 'depends'),
    }
    const edges = overviewEdges(scannerish, null)
    expect(edges.length).toBe(sample.edges.filter((e) => e.kind === 'depends').length)
    expect(edges.length).toBeGreaterThan(0)
  })
})
