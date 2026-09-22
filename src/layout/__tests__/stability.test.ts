import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { computeLayout } from '../index.js'
import { positionsById } from '../types.js'
import { SCENARIOS, loadBaseDocument } from '../../testing/scenarios.js'
import { diffLayouts, formatDiff, withinBudget } from '../../testing/stability.js'

const base = loadBaseDocument()
const layoutOf = (markdown: string) => positionsById(computeLayout(parse(markdown, 'f.md').graph))
const baseline = layoutOf(base)

/**
 * The load-bearing suite. Position stability is what decides whether the map survives the
 * Phase 6 hot-reload loop, where the layout is recomputed on every Markdown save while the
 * user is looking at it — so it is measured as a number against a budget, not asserted.
 */
describe('stability under editing', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id} — ${scenario.title} (budget: ${scenario.budget})`, () => {
      const diff = diffLayouts(baseline, layoutOf(scenario.apply(base)))
      expect(
        withinBudget(diff.impact, scenario.budget),
        `${scenario.id} exceeded its ${scenario.budget} budget\n${formatDiff(diff)}\n\n${scenario.discriminates}`,
      ).toBe(true)
    })
  }

  it('S3 and S8 are exactly zero, not merely small', () => {
    // A rename and a reformat change no address key at all, so these are provable rather
    // than measured. If either ever becomes non-zero, something started reading a label or
    // a declaration order and every other guarantee is suspect.
    for (const id of ['S3', 'S8']) {
      const scenario = SCENARIOS.find((s) => s.id === id)!
      const diff = diffLayouts(baseline, layoutOf(scenario.apply(base)))
      expect(diff.moved, `${id}: ${formatDiff(diff)}`).toBe(0)
      expect(diff.added).toEqual([])
      expect(diff.removed).toEqual([])
    }
  })

  it('S4 moves nothing, because dependency edges have no positional influence', () => {
    const scenario = SCENARIOS.find((s) => s.id === 'S4')!
    const diff = diffLayouts(baseline, layoutOf(scenario.apply(base)))
    expect(diff.moved, formatDiff(diff)).toBe(0)
  })

  it('a reformatted document produces an identical layout hash', () => {
    const scenario = SCENARIOS.find((s) => s.id === 'S8')!
    const before = computeLayout(parse(base, 'f.md').graph)
    const after = computeLayout(parse(scenario.apply(base), 'f.md').graph)
    expect(after.layoutHash).toBe(before.layoutHash)
  })
})

/**
 * Guards the rule that makes cross-engine reproducibility possible at all: only `+ - * /`
 * and `sqrt` are correctly rounded by the ECMAScript spec. Everything else is
 * implementation-approximated, so two browsers can disagree in the last bit and the layout
 * stops being byte-identical. One reviewer caught a competing design asserting this
 * discipline and then violating it twice; a lint test is cheaper than that mistake.
 */
describe('numeric purity', () => {
  const dir = fileURLToPath(new URL('../', import.meta.url))
  const banned = /Math\.(pow|log|log2|log10|sin|cos|tan|hypot|cbrt|exp|random)\b/

  /** Blank out comments so prose about the rule does not trip the rule. */
  const codeOnly = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, '')

  const sources = () =>
    readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => ({ file, code: codeOnly(readFileSync(dir + file, 'utf8')) }))

  it('src/layout uses no implementation-approximated math', () => {
    const offenders: string[] = []
    for (const { file, code } of sources()) {
      code.split('\n').forEach((line, index) => {
        if (banned.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`)
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('uses no exponent operator either', () => {
    // `a ** b`, not a JSDoc opener.
    for (const { file, code } of sources()) {
      expect(code, file).not.toMatch(/[\w)\]]\s*\*\*\s*[\w(]/)
    }
  })
})
