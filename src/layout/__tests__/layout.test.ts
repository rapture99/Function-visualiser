import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Graph } from '../../schema/graph.js'
import { LAYERS } from '../../schema/kinds.js'
import { computeLayout, bandOf, terraceY } from '../index.js'
import { positionsById } from '../types.js'
import { CELL, LAYER_Y, PHASE_PITCH, TERRACES } from '../constants.js'
import { hilbertDToXY, hilbertXYToD } from '../hilbert.js'
import { bitLength, hash32, q } from '../hash.js'
import { modulesForNodeCount, synthDocument } from '../../testing/synth.js'
import { parse } from '../../parser/index.js'

/** Parsed from the Markdown itself, so the suite never depends on `npm run parse` having run. */
const load = (relative: string): Graph =>
  parse(
    readFileSync(
      fileURLToPath(new URL(`../../testing/fixtures/${relative}`, import.meta.url)),
      'utf8',
    ),
    relative,
  ).graph

const sample = load('sample-system.md')
const hrms = load('hrms-leave.md')
const fn = load('sample-function.md')

/** A fixed, non-identity permutation — enough to prove nothing reads array order. */
function shuffle(graph: Graph): Graph {
  return {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
    workflows: [...graph.workflows].reverse(),
  }
}

describe('primitives', () => {
  it('hash32 is a stable 32-bit value', () => {
    expect(hash32('leave-service')).toBe(hash32('leave-service'))
    expect(hash32('leave-service')).toBeGreaterThanOrEqual(0)
    expect(hash32('leave-service')).toBeLessThan(2 ** 32)
    expect(hash32('a')).not.toBe(hash32('b'))
  })

  it('bitLength matches a doubling bucket', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 15, 16].map(bitLength)).toEqual([0, 1, 2, 2, 3, 3, 4, 4, 5])
  })

  it('q quantises to an exactly representable dyadic', () => {
    expect(q(1 / 3)).toBe(0.3125)
    expect(q(1 / 3) * 16).toBe(5)
  })

  it('the Hilbert index is a bijection over grid x grid', () => {
    for (const grid of [2, 4, 8, 16]) {
      const seen = new Set<number>()
      for (let x = 0; x < grid; x++) {
        for (let y = 0; y < grid; y++) {
          const d = hilbertXYToD(grid, x, y)
          expect(seen.has(d)).toBe(false)
          seen.add(d)
          expect(hilbertDToXY(grid, d)).toEqual([x, y])
        }
      }
      expect(seen.size).toBe(grid * grid)
    }
  })

  it('doubling the grid keeps a point inside its former quadrant', () => {
    // This is the property that makes a crowded cell's growth almost invisible.
    for (const seed of ['a', 'leave-service', 'f01-page', 'zzz']) {
      const at = (grid: number) => Math.floor((hash32(seed) / 4294967296) * grid)
      expect(at(4) >> 1).toBe(at(2))
      expect(at(8) >> 1).toBe(at(4))
    }
  })
})

describe('geometry', () => {
  it('places every kind on a terrace, and errors always at the bottom of their layer', () => {
    for (const layer of LAYERS) {
      const terraces = TERRACES[layer]
      expect(terraces[terraces.length - 1]).toEqual(['error'])
      expect(bandOf(layer, 'error')).toBe(terraces.length - 1)
    }
  })

  it('leaves a clear void between adjacent layer planes', () => {
    // Each layer's terraces are centred on its plane; the stacks must not meet.
    const extent = (layer: (typeof LAYERS)[number]) => {
      const count = TERRACES[layer].length
      return { top: terraceY(layer, 0), bottom: terraceY(layer, count - 1) }
    }
    for (let i = 0; i < LAYERS.length - 1; i++) {
      const upper = extent(LAYERS[i]!)
      const lower = extent(LAYERS[i + 1]!)
      expect(upper.bottom - lower.top).toBeGreaterThanOrEqual(48)
    }
  })

  it('keeps every node inside its column, so the gutter between columns stays empty', () => {
    for (const graph of [sample, hrms, fn]) {
      const result = computeLayout(graph)
      for (let i = 0; i < result.nodeIds.length; i++) {
        const x = result.positions[i * 3]!
        const phase = result.slots[i * 4]!
        expect(Math.abs(x - PHASE_PITCH * phase)).toBeLessThanOrEqual(CELL / 2)
      }
    }
  })

  it('keeps every node inside its district slab', () => {
    const result = computeLayout(hrms)
    const at = positionsById(result)
    for (const frame of result.modules) {
      for (const id of frame.memberIds) {
        expect(Math.abs(at[id]!.z - frame.z)).toBeLessThanOrEqual(CELL / 2)
      }
    }
  })

  it('puts each node on its authoritative layer plane, never a neighbouring one', () => {
    const result = computeLayout(hrms)
    const at = positionsById(result)
    for (const node of hrms.nodes) {
      if (node.kind === 'module') continue
      const count = TERRACES[node.layer].length
      const y = at[node.id]!.y
      expect(y).toBeLessThanOrEqual(LAYER_Y[node.layer] + ((count - 1) / 2) * 16)
      expect(y).toBeGreaterThanOrEqual(LAYER_Y[node.layer] - ((count - 1) / 2) * 16)
    }
  })

  it('never places two nodes at the same point', () => {
    for (const graph of [sample, hrms, fn]) {
      const result = computeLayout(graph)
      const seen = new Set<string>()
      const at = positionsById(result)
      for (const id of result.nodeIds) {
        const p = at[id]!
        const key = `${p.x}|${p.y}|${p.z}`
        expect(seen.has(key), `${id} collides`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('drops an error into the same column as the step it branches from', () => {
    const result = computeLayout(sample)
    const phaseOf = (id: string) => result.slots[result.nodeIds.indexOf(id) * 4]!
    const at = positionsById(result)

    for (const workflow of sample.workflows) {
      for (const error of workflow.errors) {
        // Same column, so the error edge is a vertical drop rather than a diagonal. The two
        // still differ by a micro-offset inside the cell, which is why this checks the
        // column and not the raw x.
        expect(phaseOf(error.errorNodeId)).toBe(phaseOf(error.atNodeId))
        expect(Math.abs(at[error.errorNodeId]!.x - at[error.atNodeId]!.x)).toBeLessThanOrEqual(CELL)
        // ...and strictly below it, because error is the bottom terrace of every layer.
        expect(at[error.errorNodeId]!.y).toBeLessThan(at[error.atNodeId]!.y)
      }
    }
  })

  it('collapses a module-less document into a single district', () => {
    const result = computeLayout(fn)
    expect(result.modules).toHaveLength(1)
    expect(result.modules[0]!.z).toBe(0)
    const at = positionsById(result)
    for (const id of result.nodeIds) expect(Math.abs(at[id]!.z)).toBeLessThanOrEqual(CELL / 2)
  })
})

describe('determinism', () => {
  it('is byte-identical across runs', () => {
    for (const graph of [sample, hrms, fn]) {
      const a = computeLayout(graph)
      const b = computeLayout(graph)
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
      expect(a.layoutHash).toBe(b.layoutHash)
    }
  })

  it('is invariant to the order of nodes, edges and workflows', () => {
    for (const graph of [sample, hrms, fn]) {
      const straight = computeLayout(graph)
      const shuffled = computeLayout(shuffle(graph))
      expect(shuffled.nodeIds).toEqual(straight.nodeIds)
      expect(Array.from(shuffled.positions)).toEqual(Array.from(straight.positions))
      expect(shuffled.layoutHash).toBe(straight.layoutHash)
    }
  })

  it('emits only quantised coordinates', () => {
    const result = computeLayout(hrms)
    for (const value of result.positions) {
      expect(Number.isInteger(value * 16)).toBe(true)
    }
  })
})

describe('output', () => {
  it('describes layers, districts and columns', () => {
    const result = computeLayout(hrms)
    expect(result.layers.map((l) => l.layer)).toEqual(['actor', 'interface', 'logic', 'data', 'external'])
    expect(result.modules.map((m) => m.name)).toEqual([
      'Access', 'Attendance', 'Client', 'Leave API', 'Notifications', 'Storage',
    ])
    expect(result.columns[0]!.label).toMatch(/^1 · /)
    expect(result.columns.length).toBeGreaterThan(8)
  })

  it('excludes module containers from the positioned nodes', () => {
    const result = computeLayout(hrms)
    expect(result.nodeIds.some((id) => id.startsWith('module/'))).toBe(false)
    expect(result.nodeIds).toHaveLength(hrms.nodes.filter((n) => n.kind !== 'module').length)
  })
})

describe('scale', () => {
  it('lays out 2000 nodes quickly', () => {
    const graph = parse(synthDocument({ modules: modulesForNodeCount(2000) }), 'synth.md').graph
    const started = process.hrtime.bigint()
    const result = computeLayout(graph)
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(result.nodeIds.length).toBeGreaterThan(1900)
    expect(elapsedMs).toBeLessThan(1000)
  })
})
