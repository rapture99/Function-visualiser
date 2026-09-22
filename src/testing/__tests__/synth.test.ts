import { describe, expect, it } from 'vitest'
import { modulesForNodeCount, synthDocument } from '../synth.js'
import { parse } from '../../parser/index.js'

/**
 * The generator only earns its keep if its output is indistinguishable from a hand-written
 * document as far as the parser is concerned. A scale fixture that produces warnings would
 * be measuring the wrong thing.
 */
describe('synthetic documents', () => {
  for (const target of [25, 100, 500, 2000]) {
    const modules = modulesForNodeCount(target)

    it(`parses cleanly at ~${target} nodes (${modules} modules)`, () => {
      const result = parse(synthDocument({ modules }), 'synth.md')
      expect(result.diagnostics).toEqual([])
      expect(result.graph.workflows).toHaveLength(modules * 2)
    })
  }

  it('reproduces the logic-heavy layer distribution that makes density a real problem', () => {
    const { graph } = parse(synthDocument({ modules: 10 }), 'synth.md')
    const declared = graph.nodes.filter((n) => !n.implicit)
    const byLayer = declared.reduce<Record<string, number>>((acc, n) => {
      acc[n.layer] = (acc[n.layer] ?? 0) + 1
      return acc
    }, {})

    // 10 modules x 12 nodes + 2 actors: interface 30, logic 70, data 20.
    expect(byLayer).toEqual({ actor: 2, interface: 30, logic: 70, data: 20 })
    expect(byLayer.logic! / declared.length).toBeGreaterThan(0.5)
  })

  it('produces cross-module dependency edges so module placement matters', () => {
    const { graph } = parse(synthDocument({ modules: 5 }), 'synth.md')
    const crossModule = graph.edges.filter((e) => {
      if (e.kind !== 'depends') return false
      const from = graph.nodes.find((n) => n.id === e.from)
      const to = graph.nodes.find((n) => n.id === e.to)
      return from?.module !== to?.module
    })
    expect(crossModule).toHaveLength(5)
  })

  it('shares backend nodes between workflows and hands over roles mid-flow', () => {
    const { graph } = parse(synthDocument({ modules: 2 }), 'synth.md')

    const service = graph.nodes.find((n) => n.id === 'f01-service')!
    expect(service.workflows).toEqual(['f01-create', 'f01-read'])

    const create = graph.workflows.find((w) => w.id === 'f01-create')!
    expect(create.steps.at(-1)!.role).toBe('Admin')
    expect(create.steps[0]!.role).toBe('User')
  })

  it('is a pure function of its options', () => {
    expect(synthDocument({ modules: 7 })).toBe(synthDocument({ modules: 7 }))
  })

  it('scales parsing linearly enough to be usable as a fixture', () => {
    const md = synthDocument({ modules: modulesForNodeCount(2000) })
    const started = process.hrtime.bigint()
    const result = parse(md, 'synth.md')
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(result.graph.nodes.length).toBeGreaterThan(1900)
    // Generous: this guards against accidental quadratic behaviour, not against slowness.
    expect(elapsedMs).toBeLessThan(5000)
  })
})
