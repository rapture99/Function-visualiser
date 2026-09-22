import { describe, expect, it } from 'vitest'
import { diffLayouts, sceneDiagonal, withinBudget, type Positions } from '../stability.js'

const grid: Positions = {
  a: { x: 0, y: 0, z: 0 },
  b: { x: 100, y: 0, z: 0 },
  c: { x: 0, y: 100, z: 0 },
  d: { x: 100, y: 100, z: 100 },
}

const shift = (positions: Positions, id: string, by: number): Positions => ({
  ...positions,
  [id]: { ...positions[id]!, x: positions[id]!.x + by },
})

describe('sceneDiagonal', () => {
  it('measures the bounding box diagonal', () => {
    expect(sceneDiagonal(grid)).toBeCloseTo(Math.sqrt(100 ** 2 * 3), 6)
  })

  it('never returns zero, so normalisation cannot divide by zero', () => {
    expect(sceneDiagonal({ only: { x: 5, y: 5, z: 5 } })).toBe(1)
    expect(sceneDiagonal({})).toBe(1)
  })
})

describe('diffLayouts', () => {
  it('reports an identical layout as no movement at all', () => {
    const diff = diffLayouts(grid, { ...grid })
    expect(diff.impact).toBe('none')
    expect(diff.unchanged).toBe(4)
    expect(diff.moved).toBe(0)
    expect(diff.fractionMoved).toBe(0)
  })

  it('normalises movement against the scene, not world units', () => {
    const diff = diffLayouts(grid, shift(grid, 'a', 17.32))
    // 17.32 units across a ~173.2 unit diagonal is 10% of the scene.
    expect(diff.maxNormalized).toBeCloseTo(0.1, 3)
    expect(diff.impact).toBe('same-neighbourhood')
  })

  it('separates a tiny nudge from a wholesale reshuffle', () => {
    expect(diffLayouts(grid, shift(grid, 'a', 0.5)).impact).toBe('imperceptible')
    expect(diffLayouts(grid, shift(grid, 'a', 100)).impact).toBe('arbitrary')
  })

  it('counts a widespread small movement as more than imperceptible', () => {
    // One node nudged is noise; every node nudged is the whole map breathing.
    const all = Object.keys(grid).reduce<Positions>((acc, id) => shift(acc, id, 0.5), grid)
    const diff = diffLayouts(grid, all)
    expect(diff.maxNormalized).toBeLessThan(0.01)
    expect(diff.impact).toBe('same-neighbourhood')
  })

  it('tracks added and removed nodes without counting them as movement', () => {
    const { d: _d, ...withoutD } = grid
    const diff = diffLayouts(grid, { ...withoutD, e: { x: 5, y: 5, z: 5 } })
    expect(diff.removed).toEqual(['d'])
    expect(diff.added).toEqual(['e'])
    expect(diff.surviving).toBe(3)
    expect(diff.impact).toBe('none')
  })

  it('ranks the worst offenders first', () => {
    const moved = shift(shift(grid, 'a', 40), 'b', 5)
    const diff = diffLayouts(grid, moved)
    expect(diff.worst.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('honours an epsilon for algorithms with floating point noise', () => {
    const noisy = shift(grid, 'a', 1e-9)
    expect(diffLayouts(grid, noisy).impact).toBe('imperceptible')
    expect(diffLayouts(grid, noisy, { epsilon: 1e-6 }).impact).toBe('none')
  })
})

describe('withinBudget', () => {
  it('accepts anything at or below the budget and rejects worse', () => {
    expect(withinBudget('none', 'imperceptible')).toBe(true)
    expect(withinBudget('imperceptible', 'imperceptible')).toBe(true)
    expect(withinBudget('same-neighbourhood', 'imperceptible')).toBe(false)
    expect(withinBudget('arbitrary', 'same-neighbourhood')).toBe(false)
  })
})
