import { describe, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { computeLayout } from '../index.js'
import { positionsById } from '../types.js'
import { SCENARIOS, loadBaseDocument } from '../../testing/scenarios.js'
import { diffLayouts, sceneDiagonal } from '../../testing/stability.js'

/**
 * Not an assertion — a printed table. The stability suite proves the budgets hold; this
 * shows what the numbers actually are, so a regression that stays inside budget is still
 * visible in CI output.
 */
describe('stability report', () => {
  it('prints the measured movement for S1-S8', () => {
    const base = loadBaseDocument()
    const layoutOf = (md: string) => positionsById(computeLayout(parse(md, 'f.md').graph))
    const baseline = layoutOf(base)

    const rows = SCENARIOS.map((scenario) => {
      const diff = diffLayouts(baseline, layoutOf(scenario.apply(base)))
      return [
        scenario.id,
        diff.impact.padEnd(19),
        `${String(diff.moved).padStart(2)}/${String(diff.surviving).padEnd(2)}`,
        `max ${(diff.maxNormalized * 100).toFixed(2).padStart(5)}%`,
        `+${diff.added.length} -${diff.removed.length}`,
        `budget ${scenario.budget}`,
      ].join('  ')
    })

    console.log(
      [
        '',
        `scene diagonal: ${sceneDiagonal(baseline).toFixed(0)} units, ${Object.keys(baseline).length} nodes`,
        'id  impact               moved  max movement  churn  budget',
        ...rows,
        '',
      ].join('\n'),
    )
  })
})
