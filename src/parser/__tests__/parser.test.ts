import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../index.js'
import { CODES } from '../diagnostics.js'
import type { Diagnostic } from '../../schema/graph.js'

const p = (md: string) => parse(md, 'test.md')
const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code)
const docPath = (rel: string) =>
  fileURLToPath(new URL(`../../testing/fixtures/${rel}`, import.meta.url))

const MINIMAL = `
# App: Test
Scope: feature

### Node: page
Type: Page

### Node: endpoint
Type: Endpoint

## Workflow: flow
Roles: User

Steps:
1. page
2. endpoint
`

describe('nodes', () => {
  it('parses declarations and derives name, layer and source line', () => {
    const { graph, errorCount } = p(MINIMAL)
    expect(errorCount).toBe(0)

    const page = graph.nodes.find((n) => n.id === 'page')!
    expect(page.kind).toBe('ui')
    expect(page.layer).toBe('interface')
    expect(page.name).toBe('Page')
    expect(page.source.line).toBe(5)
    expect(graph.meta.scope).toBe('feature')
    expect(graph.meta.title).toBe('Test')
  })

  it('accepts type aliases and derives the layer from the canonical kind', () => {
    const cases: [string, string, string][] = [
      ['Database', 'entity', 'data'],
      ['db', 'entity', 'data'],
      ['Screen', 'ui', 'interface'],
      ['Approval', 'decision', 'logic'],
      ['third-party', 'external', 'external'],
      ['Hook', 'function', 'logic'],
    ]
    for (const [authored, kind, layer] of cases) {
      const { graph } = p(`### Node: x\nType: ${authored}\n`)
      const node = graph.nodes.find((n) => n.id === 'x')!
      expect([authored, node.kind, node.layer]).toEqual([authored, kind, layer])
    }
  })

  it('collects unrecognised keys into meta for the detail panel', () => {
    const { graph } = p(`### Node: api\nType: Endpoint\nMethod: POST\nPath: /api/x\n`)
    expect(graph.nodes[0]!.meta).toEqual({ Method: 'POST', Path: '/api/x' })
  })

  it('uses prose under the heading as the description', () => {
    const { graph } = p(`### Node: svc\nType: Service\nDoes the thing.\n`)
    expect(graph.nodes[0]!.description).toBe('Does the thing.')
  })

  it('reports a missing or unknown Type', () => {
    expect(codes(p(`### Node: x\nName: X\n`).diagnostics)).toContain(CODES.MISSING_TYPE)

    const unknown = p(`### Node: x\nType: Serivce\n`)
    const d = unknown.diagnostics.find((x) => x.code === CODES.UNKNOWN_TYPE)!
    expect(d.hint).toContain('service')
    expect(d.line).toBe(2)
  })

  it('rejects duplicate ids and keeps the first declaration', () => {
    const { graph, diagnostics } = p(
      `### Node: x\nType: Service\nName: First\n\n### Node: x\nType: Service\nName: Second\n`,
    )
    expect(codes(diagnostics)).toContain(CODES.DUPLICATE_NODE)
    expect(graph.nodes.filter((n) => n.id === 'x')).toHaveLength(1)
    expect(graph.nodes[0]!.name).toBe('First')
  })

  it('warns about declared-but-unused nodes', () => {
    const { diagnostics } = p(`### Node: lonely\nType: Service\n`)
    expect(codes(diagnostics)).toContain(CODES.ORPHAN_NODE)
  })
})

describe('references', () => {
  it('creates a visible ghost node rather than dropping an unknown reference', () => {
    const { graph, diagnostics } = p(`${MINIMAL}\n3. typo-node\n`)

    const ghost = graph.nodes.find((n) => n.id === 'typo-node')!
    expect(ghost.kind).toBe('unresolved')
    expect(ghost.implicit).toBe(true)
    expect(codes(diagnostics)).toContain(CODES.UNKNOWN_NODE_REF)
    // The step still exists, so the workflow renders with a broken link in it.
    expect(graph.workflows[0]!.steps).toHaveLength(3)
  })

  it('suggests a nearby id when one exists', () => {
    const { diagnostics } = p(`${MINIMAL}\n3. endpoit\n`)
    expect(diagnostics.find((d) => d.code === CODES.UNKNOWN_NODE_REF)!.hint).toContain('endpoint')
  })

  it('builds depends edges and flags unknown dependencies', () => {
    const { graph, diagnostics } = p(
      `### Node: a\nType: Service\nDependencies: b, nope\n\n### Node: b\nType: Service\n`,
    )
    expect(graph.edges.find((e) => e.kind === 'depends' && e.to === 'b')).toBeTruthy()
    expect(codes(diagnostics)).toContain(CODES.UNKNOWN_DEPENDENCY)
  })
})

describe('workflow steps', () => {
  it('infers edge kind from the target and keeps notes', () => {
    const { graph } = p(`${MINIMAL}\n3. store (write) — persists it\n\n### Node: store\nType: Table\n`)
    const edges = graph.edges.filter((e) => e.workflowId === 'flow')
    expect(edges.map((e) => e.kind)).toEqual(['calls', 'writes'])
    expect(graph.workflows[0]!.steps[2]!.note).toBe('persists it')
  })

  it('warns when a data node is touched without read or write', () => {
    const { graph, diagnostics } = p(`${MINIMAL}\n3. store\n\n### Node: store\nType: Table\n`)
    expect(codes(diagnostics)).toContain(CODES.AMBIGUOUS_DATA_ACCESS)
    // It still produces an edge — flagged, not dropped — defaulting to the safer read.
    expect(graph.edges.find((e) => e.to === 'store')!.kind).toBe('reads')
  })

  it('switches the acting role from the annotated step onward', () => {
    const md = `${MINIMAL}\n3. approve (role: Admin)\n4. done\n
### Node: approve
Type: Approval

### Node: done
Type: Service
`
    const steps = p(md).graph.workflows[0]!.steps
    expect(steps.map((s) => s.role)).toEqual(['User', 'User', 'Admin', 'Admin'])
    expect(p(md).graph.nodes.find((n) => n.id === 'done')!.rolesReached).toEqual(['Admin'])
    expect(p(md).graph.nodes.find((n) => n.id === 'page')!.rolesReached).toEqual(['User'])
  })

  it('carries when: and label: annotations onto the edge', () => {
    const { graph } = p(`${MINIMAL.replace('2. endpoint', '2. endpoint (when: logged in, label: submit)')}`)
    const edge = graph.edges.find((e) => e.to === 'endpoint')!
    expect(edge.condition).toBe('logged in')
    expect(edge.label).toBe('submit')
  })

  it('warns on unknown annotations instead of ignoring them', () => {
    const { diagnostics } = p(MINIMAL.replace('2. endpoint', '2. endpoint (writ)'))
    const d = diagnostics.find((x) => x.code === CODES.UNKNOWN_ANNOTATION)!
    expect(d.hint).toContain('write')
  })

  it('does not create a self-edge for a repeated step', () => {
    const { graph, diagnostics } = p(`${MINIMAL}\n3. endpoint\n`)
    expect(codes(diagnostics)).toContain(CODES.REPEATED_STEP)
    expect(graph.edges.filter((e) => e.from === e.to)).toHaveLength(0)
  })

  it('warns about a workflow with no steps', () => {
    expect(codes(p(`### Node: a\nType: Service\n\n## Workflow: empty\nName: Empty\n`).diagnostics))
      .toContain(CODES.EMPTY_WORKFLOW)
  })
})

describe('error paths', () => {
  const md = `${MINIMAL}
Errors:
- at endpoint -> validation-error: bad payload
- at page: session expired
`

  it('supports the explicit and inline forms', () => {
    const { graph, errorCount } = p(md)
    expect(errorCount).toBe(0)

    const [explicit, inline] = graph.workflows[0]!.errors
    expect(explicit!.errorNodeId).toBe('validation-error')
    expect(inline!.errorNodeId).toBe('error/session-expired')
    expect(inline!.reason).toBe('session expired')
    expect(graph.edges.filter((e) => e.kind === 'error')).toHaveLength(2)
  })

  it('places an error node in the same layer as the step it branches from', () => {
    const { graph } = p(md)
    expect(graph.nodes.find((n) => n.id === 'error/session-expired')!.layer).toBe('interface')
    expect(graph.nodes.find((n) => n.id === 'validation-error')!.layer).toBe('logic')
  })

  it('reports unparseable error lines', () => {
    expect(codes(p(`${MINIMAL}\nErrors:\n- something went wrong\n`).diagnostics))
      .toContain(CODES.INVALID_ERROR)
  })
})

describe('modules', () => {
  it('creates a container node with contains edges', () => {
    const { graph } = p(`## Module: Billing\n\n### Node: a\nType: Service\n\n### Node: b\nType: Table\n
## Workflow: f
Steps:
1. a
2. b (read)
`)
    const module = graph.nodes.find((n) => n.kind === 'module')!
    expect(module.id).toBe('module/billing')
    expect(graph.edges.filter((e) => e.kind === 'contains')).toHaveLength(2)
    expect(graph.nodes.find((n) => n.id === 'a')!.parentId).toBe('module/billing')
  })

  it('ends at the next workflow heading', () => {
    const { graph } = p(`## Module: A\n\n### Node: x\nType: Service\n\n## Workflow: w\nSteps:\n1. x\n
## Module: B

### Node: y
Type: Service
Dependencies: x
`)
    expect(graph.nodes.find((n) => n.id === 'y')!.module).toBe('B')
    expect(graph.nodes.find((n) => n.id === 'x')!.module).toBe('A')
  })
})

describe('scanning', () => {
  it('ignores fenced code blocks so examples are never parsed as declarations', () => {
    const { graph } = p('```md\n### Node: fake\nType: Service\n```\n\n### Node: real\nType: Service\n')
    expect(graph.nodes.map((n) => n.id)).toEqual(['real'])
  })

  it('does not let a nested fence leak content out of a longer one', () => {
    // A guide to this format quotes fenced examples inside a longer fence. Toggling on any
    // ``` would end the outer fence at the inner one and parse the example as real.
    const { graph } = p(
      '````text\n```md\n### Node: fake\nType: Service\n```\nstill quoted\n````\n\n### Node: real\nType: Service\n',
    )
    expect(graph.nodes.map((n) => n.id)).toEqual(['real'])
  })

  it('closes a fence only with the same character', () => {
    const { graph } = p('```\n~~~\n### Node: fake\nType: Service\n```\n\n### Node: real\nType: Service\n')
    expect(graph.nodes.map((n) => n.id)).toEqual(['real'])
  })

  it('ignores HTML comments', () => {
    const { graph } = p('<!--\n### Node: hidden\nType: Service\n-->\n\n### Node: real\nType: Service\n')
    expect(graph.nodes.map((n) => n.id)).toEqual(['real'])
  })

  it('treats ids case-insensitively', () => {
    const { errorCount, graph } = p(`### Node: MyService\nType: Service\n\n## Workflow: w\nSteps:\n1. myservice\n2. MYSERVICE\n`)
    expect(graph.nodes.map((n) => n.id)).toEqual(['myservice'])
    expect(errorCount).toBe(0)
  })
})

describe('output stability', () => {
  it('is byte-identical for identical input', () => {
    const a = JSON.stringify(p(MINIMAL).graph)
    const b = JSON.stringify(p(MINIMAL).graph)
    expect(a).toBe(b)
  })

  it('contains no timestamps or absolute paths', () => {
    const json = JSON.stringify(p(MINIMAL).graph)
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(json).not.toMatch(/[A-Za-z]:\\/)
  })
})

describe('shipped documents', () => {
  for (const doc of ['sample-system.md', 'sample-function.md', 'sample-feature.md']) {
    it(`${doc} parses with no errors or warnings`, () => {
      const result = parse(readFileSync(docPath(doc), 'utf8'), doc)
      expect(result.diagnostics).toEqual([])
      expect(result.graph.nodes.length).toBeGreaterThan(0)
      expect(result.graph.workflows.length).toBeGreaterThan(0)
    })
  }

  it('links the sample workflows through the shared backend nodes', () => {
    const { graph } = parse(readFileSync(docPath('sample-system.md'), 'utf8'), 'sample-system.md')
    const service = graph.nodes.find((n) => n.id === 'leave-service')!
    expect(service.workflows).toEqual(['apply-leave', 'reject-leave'])
    expect(service.rolesReached.sort()).toEqual(['Admin', 'Employee'])
  })
})
