import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scanProject, scanProjects } from '../scan.js'
import { buildDraft, featureOf, moduleOf, renderDraft, splitByFeature } from '../draft.js'
import type { Draft, DraftNode } from '../draft.js'
import { normalisePath } from '../rules.js'
import { parse } from '../../parser/index.js'

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
const report = scanProject(fixtures)
const draft = buildDraft(report, 'Fixtures')

const routes = () =>
  report.findings.filter((f) => f.route).map((f) => `${f.route!.method} ${f.route!.path}`)

describe('normalisePath', () => {
  it('strips interpolation, quotes and query strings', () => {
    expect(normalisePath('${API}/leaves')).toBe('/leaves')
    expect(normalisePath('/api/x/')).toBe('/api/x')
    expect(normalisePath('users')).toBe('/users')
    expect(normalisePath('/a//b?x=1')).toBe('/a/b')
    expect(normalisePath('/invoices/${id}/pay')).toBe('/invoices//pay'.replace('//', '/'))
  })
})

describe('moduleOf', () => {
  it('groups a feature across layer folders by stripping role suffixes', () => {
    // The point of the whole heuristic: these three belong together.
    expect(moduleOf('back/routes/leaves.routes.js')).toBe('Leaves')
    expect(moduleOf('back/controllers/leaves.controller.js')).toBe('Leaves')
    expect(moduleOf('src/services/LeaveService.ts')).toBe('Leave')
  })

  it('falls back to the directory when the filename is generic', () => {
    expect(moduleOf('billing/index.ts')).toBe('Billing')
    expect(moduleOf('src/features/checkout/index.ts')).toBe('Checkout')
  })

  it('uses a neutral bucket when nothing in the path names a feature', () => {
    // `src/app/main.py` has no feature signal anywhere; calling it "Src" would be worse
    // than admitting there isn't one.
    expect(moduleOf('src/app/main.py')).toBe('Core')
    expect(moduleOf('backend/server.js')).toBe('Core')
  })
})

describe('cross-stack extraction', () => {
  it('finds Express routes', () => {
    expect(routes()).toEqual(
      expect.arrayContaining(['GET /invoices', 'POST /invoices', 'PUT /invoices/:id/pay']),
    )
  })

  it('finds FastAPI decorator routes', () => {
    expect(routes()).toEqual(expect.arrayContaining(['GET /orders', 'POST /orders']))
  })

  it('finds a Mongoose model and a Django model', () => {
    const entities = report.findings.filter((f) => f.kind === 'entity').map((f) => f.name)
    expect(entities).toEqual(expect.arrayContaining(['Invoice', 'Product']))
  })

  it('recognises pages and services from directory conventions', () => {
    const byKind = report.conventions.reduce<Record<string, string[]>>((acc, hit) => {
      ;(acc[hit.kind] ??= []).push(hit.file)
      return acc
    }, {})
    expect(byKind.ui?.some((f) => f.includes('InvoiceList'))).toBe(true)
    expect(byKind.service?.some((f) => f.includes('invoices.service'))).toBe(true)
  })

  it('resolves an Angular BASE + path call', () => {
    const calls = report.findings.filter((f) => f.calls).map((f) => f.calls!.path)
    expect(calls).toContain('/invoices//pay'.replace('//', '/'))
  })

  it('reports a call with a computed URL instead of guessing its route', () => {
    const computed = report.findings.filter((f) => f.unresolvedCall)
    expect(computed.length).toBeGreaterThan(0)
    expect(computed[0]!.file).toContain('invoices.service')
  })
})

describe('draft', () => {
  it('links a client call to the endpoint it hits', () => {
    const caller = draft.nodes.find((n) => n.id.includes('invoices-service'))
    expect(caller?.dependencies.length ?? 0).toBeGreaterThan(0)
    expect(draft.stats.linkedCalls).toBeGreaterThan(0)
  })

  it('never emits a workflow', () => {
    const markdown = renderDraft(draft, report)
    // The templates are inside an HTML comment, which the parser ignores.
    expect(parse(markdown, 'draft.md').graph.workflows).toHaveLength(0)
    expect(markdown).toContain('<!--')
  })

  it('says plainly that it is a draft and lists what it could not determine', () => {
    const markdown = renderDraft(draft, report)
    expect(markdown).toContain('This is a draft')
    expect(markdown).toContain('## Open questions')
    expect(draft.openQuestions.some((q) => q.includes('No workflows were generated'))).toBe(true)
  })

  it('produces a document the parser accepts', () => {
    const result = parse(renderDraft(draft, report), 'draft.md')
    expect(result.errorCount).toBe(0)
    expect(result.graph.nodes.length).toBeGreaterThan(5)
  })

  it('attaches provenance to every node', () => {
    for (const node of draft.nodes) {
      expect(node.meta.Source, `${node.id} has no Source`).toBeTruthy()
    }
  })

  it('is deterministic', () => {
    const again = buildDraft(scanProject(fixtures), 'Fixtures')
    expect(renderDraft(again, report)).toBe(renderDraft(draft, report))
  })
})

describe('multiple roots', () => {
  it('scans separate repositories as one system and prefixes provenance', () => {
    const merged = scanProjects([`${fixtures}/express`, `${fixtures}/web`])
    expect(merged.findings.some((f) => f.file.startsWith('express/'))).toBe(true)
    expect(merged.findings.some((f) => f.file.startsWith('web/'))).toBe(true)

    // Alone, the web repo's calls have no route to match; together they resolve.
    const alone = buildDraft(scanProject(`${fixtures}/web`), 'web')
    const together = buildDraft(merged, 'both')
    expect(alone.stats.linkedCalls).toBe(0)
    expect(together.stats.linkedCalls).toBeGreaterThan(0)
  })
})

describe('featureOf', () => {
  it('takes the directory after a container, not the filename', () => {
    // The failure this fixes: every component file has a unique name, so grouping by
    // filename produced one "feature" per component — 118 modules for 325 nodes on a real
    // project, 111 of them holding a single node.
    expect(featureOf('front/src/pages/Auth/Login.tsx')).toBe('Auth')
    expect(featureOf('front/src/pages/CompanyAdmin/Dashboard.tsx')).toBe('Company Admin')
    expect(featureOf('src/components/Common/WarningModal.tsx')).toBe('Common')
  })

  it('pools a vendored UI kit into one bucket', () => {
    expect(featureOf('src/components/ui/accordion.tsx')).toBe('UI kit')
    expect(featureOf('src/components/ui/button.tsx')).toBe('UI kit')
  })

  it('falls back to the filename when a container holds files directly', () => {
    // Layered backends put the feature in the filename instead of the directory.
    expect(featureOf('back/routes/auth.routes.js')).toBe('Auth')
    expect(featureOf('back/controllers/auth.controller.js')).toBe('Auth')
    expect(featureOf('front/src/services/authService.ts')).toBe('Auth')
  })

  it('lands the whole stack of one feature in the same bucket', () => {
    const paths = [
      'back/routes/auth.routes.js',
      'back/controllers/auth.controller.js',
      'front/src/pages/Auth/Login.tsx',
      'front/src/services/authService.ts',
    ]
    expect(new Set(paths.map(featureOf))).toEqual(new Set(['Auth']))
  })
})

describe('splitByFeature', () => {
  const node = (id: string, module: string, dependencies: string[] = []): DraftNode => ({
    id,
    kind: 'service',
    name: id,
    module,
    meta: { Source: `src/${module}/${id}.ts` },
    dependencies,
  })

  const draft: Draft = {
    title: 'App',
    openQuestions: ['pre-existing question'],
    stats: { endpoints: 0, entities: 0, fromConventions: 0, linkedCalls: 0, unlinkedCalls: 0, computedCalls: 0 },
    nodes: [
      node('a1', 'Alpha', ['b1']),
      node('a2', 'Alpha'),
      node('a3', 'Alpha'),
      node('b1', 'Beta'),
      node('b2', 'Beta'),
      node('b3', 'Beta'),
      node('lonely', 'Tiny'),
    ],
  }

  const parts = splitByFeature(draft, 3)

  it('writes one document per feature', () => {
    expect([...parts.keys()].sort()).toEqual(['Alpha', 'Beta', 'Other'])
  })

  it('pools features too small to be worth a file', () => {
    expect(parts.get('Other')!.nodes.map((n) => n.id)).toEqual(['lonely'])
  })

  it('re-declares a dependency that crosses a seam, tagged with where it lives', () => {
    const alpha = parts.get('Alpha')!
    const imported = alpha.nodes.find((n) => n.id === 'b1')!
    expect(imported).toBeTruthy()
    expect(imported.meta.Feature).toBe('Beta')
    expect(imported.module).toBe('Alpha boundary')
    // The import must not drag its own dependencies in behind it.
    expect(imported.dependencies).toEqual([])
  })

  it('does not import anything for a feature with no outward edges', () => {
    expect(parts.get('Beta')!.nodes.every((n) => n.module === 'Beta')).toBe(true)
  })

  it('keeps every split document independently valid', () => {
    for (const [feature, part] of parts) {
      const result = parse(renderDraft(part, { ...report, findings: [], conventions: [] }), `${feature}.md`)
      expect(result.errorCount, `${feature} has errors`).toBe(0)
      expect(result.graph.nodes.length).toBeGreaterThan(0)
    }
  })

  it('loses no node across the split', () => {
    const own = [...parts.values()].flatMap((p) => p.nodes.filter((n) => !n.module.endsWith('boundary')))
    expect(own.map((n) => n.id).sort()).toEqual(draft.nodes.map((n) => n.id).sort())
  })
})
