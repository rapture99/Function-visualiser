import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { layoutOverview, layoutWorkflow } from '../graph/layout2d.js'
import { isDrawable, layersPresent, workflowView } from '../graph/selectors.js'
import { GraphCanvas } from '../components/GraphCanvas.js'
import { DetailPanel } from '../components/DetailPanel.js'
import { Sidebar } from '../components/Sidebar.js'

/**
 * A smoke test at the component boundary, run against the real generated graph.json rather
 * than a fixture. It cannot catch a styling mistake, but it does catch the failure that
 * matters most — the app rendering an empty frame — and it exercises the whole path the
 * browser takes: zod validation, layout, and every component.
 */

const docPath = fileURLToPath(new URL('../../testing/fixtures/sample-system.md', import.meta.url))
const graph = parse(readFileSync(docPath, 'utf8'), 'sample-system.md').graph
const drawable = graph.nodes.filter(isDrawable)

describe('overview', () => {
  const layout = layoutOverview(drawable)

  it('positions every drawable node', () => {
    expect(Object.keys(layout.positions)).toHaveLength(drawable.length)
    for (const node of drawable) {
      const at = layout.positions[node.id]!
      expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true)
    }
  })

  it('produces one lane per layer present, in layer order', () => {
    expect(layout.lanes.map((l) => l.layer)).toEqual(layersPresent(graph))
  })

  it('never overlaps two nodes', () => {
    const seen = new Set<string>()
    for (const at of Object.values(layout.positions)) {
      const key = `${Math.round(at.x)}:${Math.round(at.y)}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('is deterministic', () => {
    expect(layoutOverview(drawable).positions).toEqual(layout.positions)
    // ...and independent of the order nodes arrive in, which is document order.
    expect(layoutOverview([...drawable].reverse()).positions).toEqual(layout.positions)
  })

  it('renders nodes, lane labels and module boxes', () => {
    const html = renderToStaticMarkup(
      <GraphCanvas
        nodes={drawable}
        edges={[]}
        positions={layout.positions}
        width={layout.width}
        height={layout.height}
        groups={layout.groups}
        lanes={layout.lanes}
        selectedId={null}
        onSelect={() => {}}
        fitKey="test"
      />,
    )
    expect(html).toContain('Apply Leave')
    expect(html).toContain('LeaveService')
    expect(html).toContain('Interface')
    expect(html).toContain('Notifications')
    // `class="node"` exactly — `node-box`/`node-title`/`node-sub` must not count.
    expect((html.match(/class="node(?: dim)?"/g) ?? []).length).toBe(drawable.length)
  })
})

describe('workflow view', () => {
  const view = workflowView(graph, 'apply-leave')!
  const layout = layoutWorkflow(view.nodes, view.edges)

  it('collects the steps and their error branches', () => {
    expect(view.nodes.length).toBeGreaterThanOrEqual(14)
    expect(view.steps.get('leave-service')).toEqual([7])
  })

  it('routes edges through dagre rather than straight lines', () => {
    expect(Object.keys(layout.edgePaths ?? {}).length).toBeGreaterThan(10)
  })

  it('ranks the first step above the last', () => {
    const first = layout.positions['employee']!
    const last = layout.positions['attendance-record']!
    expect(first.y).toBeLessThan(last.y)
  })

  it('renders step badges and the error path', () => {
    const html = renderToStaticMarkup(
      <GraphCanvas
        nodes={view.nodes}
        edges={view.edges}
        positions={layout.positions}
        edgePaths={layout.edgePaths}
        width={layout.width}
        height={layout.height}
        steps={view.steps}
        selectedId={null}
        onSelect={() => {}}
        fitKey="test"
      />,
    )
    expect(html).toContain('step-badge')
    expect(html).toContain('arrow-danger')
  })
})

describe('panels', () => {
  it('the detail panel shows identity, evidence metadata and connections', () => {
    const node = graph.nodes.find((n) => n.id === 'leave-service')!
    const html = renderToStaticMarkup(
      <DetailPanel graph={graph} node={node} onSelect={() => {}} onWorkflow={() => {}} />,
    )
    expect(html).toContain('LeaveService')
    expect(html).toContain('src/services/leave.service.ts')
    expect(html).toContain('sample-system.md:')
    expect(html).toContain('Employee')
    expect(html).toContain('Admin')
  })

  it('the detail panel handles an empty selection', () => {
    const html = renderToStaticMarkup(
      <DetailPanel graph={graph} node={null} onSelect={() => {}} onWorkflow={() => {}} />,
    )
    expect(html).toContain('Select a node')
  })

  it('the sidebar lists workflows, layers and roles', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        graph={graph}
        activeWorkflow={null}
        onWorkflow={() => {}}
        layers={new Set(layersPresent(graph))}
        onToggleLayer={() => {}}
        roles={new Set()}
        onToggleRole={() => {}}
        query=""
        onQuery={() => {}}
        matches={[]}
        onSelect={() => {}}
        selectedId={null}
        collapsed={new Set()}
        onToggleModule={() => {}}
        onCollapseAll={() => {}}
        onExpandAll={() => {}}
        visibleIds={new Set(graph.nodes.map((n) => n.id))}
      />,
    )
    expect(html).toContain('Apply for leave')
    expect(html).toContain('Reject a leave request')
    expect(html).toContain('14 steps')
    expect(html).toContain('Employee')
  })
})
