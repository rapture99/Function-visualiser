import { describe, expect, it } from 'vitest'
import { SCENARIOS, loadBaseDocument, withSteps } from '../scenarios.js'
import { parse } from '../../parser/index.js'
import type { Graph } from '../../schema/graph.js'

const base = loadBaseDocument()

/**
 * Strip everything that is allowed to differ between two semantically identical documents:
 * source line numbers, and the order of the node/edge arrays. What remains is the meaning.
 */
function semantic(graph: Graph) {
  const strip = <T extends { source: unknown }>(item: T) => {
    const { source: _source, ...rest } = item
    return rest
  }
  return {
    nodes: graph.nodes.map(strip).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: graph.edges.map(strip).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    workflows: graph.workflows.map((w) => ({
      ...strip(w),
      steps: w.steps.map(strip),
      errors: w.errors.map(strip),
    })),
  }
}

describe('edit scenarios', () => {
  it('the base document is the real shipped sample', () => {
    const result = parse(base, 'functionality.md')
    expect(result.diagnostics).toEqual([])
    expect(result.graph.nodes.length).toBe(23)
  })

  for (const scenario of SCENARIOS) {
    describe(`${scenario.id} — ${scenario.title}`, () => {
      const edited = scenario.apply(base)

      it('actually changes the document', () => {
        // A find/replace that silently matched nothing would score as perfectly stable.
        expect(edited).not.toBe(base)
      })

      it('still parses with no diagnostics', () => {
        const result = parse(edited, 'functionality.md')
        expect(result.diagnostics).toEqual([])
      })
    })
  }

  it('S1 and S2 differ only in where the node was declared', () => {
    const s1 = parse(SCENARIOS.find((s) => s.id === 'S1')!.apply(base), 'f.md').graph
    const s2 = parse(SCENARIOS.find((s) => s.id === 'S2')!.apply(base), 'f.md').graph
    const baseGraph = parse(base, 'f.md').graph

    // Both add exactly one node; only the document position of the declaration differs.
    expect(s1.nodes.length).toBe(baseGraph.nodes.length + 1)
    expect(s2.nodes.length).toBe(baseGraph.nodes.length + 1)
    expect(s1.nodes.findIndex((n) => n.id === 'leave-audit-log')).toBeGreaterThan(10)
    expect(s2.nodes.findIndex((n) => n.id === 'leave-policy')).toBeLessThan(4)
  })

  it('S3 changes only a display name', () => {
    const edited = parse(SCENARIOS.find((s) => s.id === 'S3')!.apply(base), 'f.md').graph
    const original = parse(base, 'f.md').graph
    expect(edited.nodes.length).toBe(original.nodes.length)
    expect(edited.edges.length).toBe(original.edges.length)
    expect(edited.nodes.find((n) => n.id === 'leave-service')!.name).toBe('Leave domain service')
  })

  it('S4 adds an edge and no nodes', () => {
    const edited = parse(SCENARIOS.find((s) => s.id === 'S4')!.apply(base), 'f.md').graph
    const original = parse(base, 'f.md').graph
    expect(edited.nodes.length).toBe(original.nodes.length)
    expect(edited.edges.length).toBe(original.edges.length + 1)
  })

  it('S6 removes the node and every trace of it', () => {
    const edited = parse(SCENARIOS.find((s) => s.id === 'S6')!.apply(base), 'f.md').graph
    expect(edited.nodes.find((n) => n.id === 'email-provider')).toBeUndefined()
    expect(edited.edges.filter((e) => e.from === 'email-provider' || e.to === 'email-provider'))
      .toHaveLength(0)
  })

  it('S7 keeps the node set identical and changes only order', () => {
    const edited = parse(SCENARIOS.find((s) => s.id === 'S7')!.apply(base), 'f.md').graph
    const original = parse(base, 'f.md').graph
    expect(edited.nodes.map((n) => n.id).sort()).toEqual(original.nodes.map((n) => n.id).sort())

    const steps = edited.workflows.find((w) => w.id === 'apply-leave')!.steps
    expect(steps[12]!.nodeId).toBe('attendance-record')
    expect(steps[13]!.nodeId).toBe('attendance-service')
  })

  /**
   * The load-bearing one. If this fails, the parser leaks document order into the graph,
   * and no layout built on top of it can possibly be stable under reformatting.
   */
  it('S8 produces a semantically identical graph', () => {
    const edited = parse(SCENARIOS.find((s) => s.id === 'S8')!.apply(base), 'f.md').graph
    const original = parse(base, 'f.md').graph
    expect(semantic(edited)).toEqual(semantic(original))
  })
})

describe('withSteps', () => {
  it('renumbers after a transform', () => {
    const out = withSteps(base, 'reject-leave', (steps) => [...steps, 'leave-service'])
    expect(out).toContain('8. leave-service')
  })

  it('throws rather than silently doing nothing', () => {
    expect(() => withSteps(base, 'no-such-workflow', (s) => s)).toThrow(/not found/)
  })
})
