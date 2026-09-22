import { describe, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { computeLayout } from '../index.js'
import { modulesForNodeCount, synthDocument } from '../../testing/synth.js'

/** Printed, not asserted — the bound lives in layout.test.ts. This shows the shape of the curve. */
describe('scale report', () => {
  it('prints layout time across sizes', () => {
    const rows: string[] = []
    for (const target of [25, 100, 500, 2000]) {
      const graph = parse(synthDocument({ modules: modulesForNodeCount(target) }), 'synth.md').graph

      computeLayout(graph) // warm
      const started = process.hrtime.bigint()
      const runs = 5
      for (let i = 0; i < runs; i++) computeLayout(graph)
      const ms = Number(process.hrtime.bigint() - started) / 1e6 / runs

      const result = computeLayout(graph)
      rows.push(
        `${String(result.nodeIds.length).padStart(5)} nodes  ` +
          `${String(graph.edges.length).padStart(5)} edges  ` +
          `${String(result.modules.length).padStart(3)} districts  ` +
          `${String(result.columns.length).padStart(3)} columns  ` +
          `${ms.toFixed(2).padStart(7)} ms`,
      )
    }
    console.log(['', ...rows, ''].join('\n'))
  })
})
