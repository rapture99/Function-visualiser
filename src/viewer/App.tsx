import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { LAYERS, type Layer } from '../schema/kinds.js'
import {
  useDocuments,
  useDroppedDocuments,
  useGraphFor,
  type DocumentSource,
} from './graph/useGraph.js'
import { layoutOverview, layoutWorkflow } from './graph/layout2d.js'
import {
  applyFilters,
  collapsedMemberIds,
  foldCollapsed,
  isDrawable,
  matchesQuery,
  neighbourIds,
  overviewEdges,
  workflowView,
} from './graph/selectors.js'
import { GraphCanvas } from './components/GraphCanvas.js'
import { Sidebar } from './components/Sidebar.js'
import { DetailPanel } from './components/DetailPanel.js'
import { DocumentDrop } from './components/DocumentDrop.js'
import { ManageDocuments } from './components/ManageDocuments.js'
import { PromptDialog } from './components/PromptDialog.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { compileTimeline, visitedThrough } from './playback/timeline.js'
import { usePlayback } from './playback/usePlayback.js'
import { PlaybackBar } from './playback/Controls.js'

/**
 * Three.js and drei are roughly a megabyte of the bundle. Loading them lazily means the 2D
 * view — which is the faster way to read a single workflow anyway — costs nothing for them,
 * and they arrive only when someone actually asks for the 3D map.
 */
const Scene3D = lazy(() => import('./three/Scene3D.js').then((m) => ({ default: m.Scene3D })))

type ViewMode = '2d' | '3d'

export function App() {
  const { state: manifest, set: setManifest } = useDocuments()
  const { dropped, add } = useDroppedDocuments()

  const documents = useMemo<DocumentSource[]>(
    () => [...(manifest.status === 'ready' ? manifest.documents : []), ...dropped],
    [manifest, dropped],
  )

  const [docKey, setDocKey] = useState<string | null>(null)
  const doc = documents.find((d) => d.key === docKey) ?? documents[0] ?? null
  const state = useGraphFor(doc)

  const [mode, setMode] = useState<ViewMode>('2d')
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(new Set(LAYERS))
  const [roles, setRoles] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // Switching documents must not leave a selection pointing at a node that no longer exists.
  useEffect(() => {
    setActiveWorkflow(null)
    setSelectedId(null)
    setQuery('')
    setRoles(new Set())
    setLayers(new Set(LAYERS))
    setCollapsed(new Set())
  }, [doc?.key])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedId(null)
      } else if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const graph = state.status === 'ready' ? state.graph : null
  const filters = useMemo(() => ({ layers, roles, query }), [layers, roles, query])

  const matches = useMemo(
    () => (graph && query ? graph.nodes.filter((n) => isDrawable(n) && matchesQuery(n, query)) : []),
    [graph, query],
  )

  const view = useMemo(() => {
    if (!graph) return null

    if (activeWorkflow) {
      const flow = workflowView(graph, activeWorkflow)
      if (!flow) return null
      return {
        mode: 'workflow' as const,
        nodes: flow.nodes,
        edges: flow.edges,
        steps: flow.steps,
        ...layoutWorkflow(flow.nodes, flow.edges),
      }
    }

    const nodes = foldCollapsed(applyFilters(graph.nodes.filter(isDrawable), filters), collapsed)
    return {
      mode: 'overview' as const,
      nodes,
      edges: overviewEdges(graph, selectedId),
      steps: undefined,
      ...layoutOverview(nodes),
    }
  }, [graph, activeWorkflow, filters, selectedId, collapsed])

  /** A workflow is playable; the overview is not. */
  const timeline = useMemo(() => {
    if (!graph || !activeWorkflow) return null
    const workflow = graph.workflows.find((w) => w.id === activeWorkflow)
    return workflow ? compileTimeline(workflow) : null
  }, [graph, activeWorkflow])

  const playback = usePlayback(timeline)
  const currentStep = timeline?.steps[playback.index] ?? null
  /**
   * Playback has started once it is running or has been stepped past the first step. Before
   * that, a freshly opened workflow is something to look at, not something being played: the
   * camera must not pan to step one and the rest of the flow must not be dimmed. Doing both
   * the moment a workflow opened hid most of the flow — measured, 10 of 19 labels off-screen.
   */
  const playbackActive = playback.playing || playback.index > 0

  const highlight = useMemo(() => {
    // Playback owns the emphasis while a workflow is open: everything reached so far stays
    // lit and the rest dims, so the path builds up rather than blinking one node at a time.
    if (timeline && playbackActive) return visitedThrough(timeline, playback.index)
    if (!graph || !selectedId) return null
    if (activeWorkflow) return neighbourIds(graph, selectedId)
    return null
  }, [graph, selectedId, activeWorkflow, timeline, playback.index, playbackActive])

  /**
   * What the 3D scene draws. Isolating a workflow to its own nodes matters far more in 3D
   * than in 2D: the lattice puts every node in the document somewhere, so without this the
   * flow you asked to follow is buried in everything you didn't.
   */
  const visibleIds = useMemo(() => {
    if (!graph) return new Set<string>()
    if (activeWorkflow) {
      const flow = workflowView(graph, activeWorkflow)
      if (flow) return new Set(flow.nodes.map((n) => n.id))
    }
    const allowed = applyFilters(graph.nodes.filter(isDrawable), filters)
    const hidden = collapsedMemberIds(allowed, collapsed)
    return new Set(allowed.filter((n) => !hidden.has(n.id)).map((n) => n.id))
  }, [graph, activeWorkflow, filters, collapsed])

  /** Modules the tree lists, so collapse-all has something to act on. */
  const allModules = useMemo(() => {
    if (!graph) return [] as string[]
    return [...new Set(graph.nodes.filter(isDrawable).map((n) => n.module ?? ''))]
  }, [graph])

  const toggleModule = (module: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(module)) next.delete(module)
      else next.add(module)
      return next
    })

  // A live reindex can delete the node that was selected, or the workflow being played.
  useEffect(() => {
    if (!graph) return
    if (selectedId && !graph.nodes.some((n) => n.id === selectedId)) setSelectedId(null)
    if (activeWorkflow && !graph.workflows.some((w) => w.id === activeWorkflow)) {
      setActiveWorkflow(null)
    }
  }, [graph, selectedId, activeWorkflow])

  const focusId = selectedId ?? currentStep?.nodeId ?? null
  const selectedNode = graph && focusId ? (graph.nodes.find((n) => n.id === focusId) ?? null) : null
  const errorCount = graph?.diagnostics.filter((d) => d.severity === 'error').length ?? 0
  const warningCount = graph?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0

  const empty = documents.length === 0

  return (
    <div className="app">
      <header className="head">
        <h1>Flow Visualizer</h1>
        <span className="sep">/</span>

        {documents.length > 0 ? (
          <select
            className="doc-select"
            value={doc?.key ?? ''}
            onChange={(event) => setDocKey(event.target.value)}
            aria-label="Document"
          >
            {['manifest', 'dropped'].map((origin) => {
              const group = documents.filter((d) => d.origin === origin)
              if (group.length === 0) return null
              return (
                <optgroup key={origin} label={origin === 'manifest' ? 'From docs' : 'Dropped'}>
                  {group.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label} · {entry.scope}
                      {entry.stats ? ` · ${entry.stats.nodes} nodes` : ''}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        ) : null}

        <DocumentDrop onAdd={add} onSelect={setDocKey} />
        <ManageDocuments
          documents={documents}
          activeKey={doc?.key ?? null}
          onDocuments={setManifest}
          onSelect={setDocKey}
        />
        <PromptDialog />

        <span className="spacer" />

        <div className="docs" role="group" aria-label="View mode">
          {(['2d', '3d'] as ViewMode[]).map((option) => (
            <button
              key={option}
              type="button"
              className="pill"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>

        {graph ? (
          <span className="meta">
            {graph.nodes.length} nodes · {graph.edges.length} edges ·{' '}
            {graph.workflows.length} workflows
            {errorCount + warningCount > 0
              ? ` · ${errorCount} errors, ${warningCount} warnings`
              : ' · clean'}
          </span>
        ) : null}
      </header>

      {empty ? (
        <div className="centre" style={{ gridColumn: '1 / -1', gridRow: 2 }}>
          <div style={{ maxWidth: 460 }}>
            <p>
              {manifest.status === 'error'
                ? 'No document index found.'
                : 'No documents yet.'}
            </p>
            <p style={{ color: 'var(--text-faint)' }}>
              Run <code>npm run parse</code> to index <code>docs/</code>, or point it anywhere:
              <br />
              <code>npm run parse -- ../some-project/docs</code>
              <br />
              <br />
              Or just drop a <code>.md</code> file or folder onto this page — it is parsed
              here, in the browser.
            </p>
          </div>
        </div>
      ) : null}

      {!empty && state.status === 'error' ? (
        <div className="centre" style={{ gridColumn: '1 / -1', gridRow: 2 }}>
          <p>{state.message}</p>
        </div>
      ) : null}

      {!empty && (state.status === 'loading' || state.status === 'idle') ? (
        <div className="centre" style={{ gridColumn: '1 / -1', gridRow: 2 }}>
          Loading {doc?.label ?? 'document'}…
        </div>
      ) : null}

      {graph && view ? (
        <>
          <Sidebar
            graph={graph}
            activeWorkflow={activeWorkflow}
            onWorkflow={(id) => {
              setActiveWorkflow(id)
              setSelectedId(null)
            }}
            layers={layers}
            onToggleLayer={(layer) =>
              setLayers((current) => {
                const next = new Set(current)
                if (next.has(layer)) next.delete(layer)
                else next.add(layer)
                return next
              })
            }
            roles={roles}
            onToggleRole={(role) =>
              setRoles((current) => {
                const next = new Set(current)
                if (next.has(role)) next.delete(role)
                else next.add(role)
                return next
              })
            }
            query={query}
            onQuery={setQuery}
            matches={matches}
            onSelect={(id) => setSelectedId(id)}
            selectedId={selectedId}
            collapsed={collapsed}
            onToggleModule={toggleModule}
            onCollapseAll={() => setCollapsed(new Set(allModules))}
            onExpandAll={() => setCollapsed(new Set())}
            visibleIds={visibleIds}
          />

          <main className="main">
            {/* The view gets its own box and the playback bar sits below it rather than
                floating over it: an overlay hid the bottom of the very flow it was playing. */}
            <div className="stage">
            {mode === '3d' ? (
              <ErrorBoundary
                resetKey={`${doc?.key ?? ''}:${mode}`}
                fallback={(error) => (
                  <div className="centre">
                    <div style={{ maxWidth: 480 }}>
                      <p>
                        <strong>The 3D view could not start here.</strong>
                      </p>
                      <p style={{ color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>{error.message}</p>
                      <button type="button" className="pill primary" onClick={() => setMode('2d')}>
                        Back to 2D
                      </button>
                    </div>
                  </div>
                )}
              >
              <Suspense fallback={<div className="centre">Loading the 3D scene…</div>}>
                <Scene3D
                  graph={graph}
                  activeWorkflow={activeWorkflow}
                  selectedId={focusId}
                  onSelect={setSelectedId}
                  followId={playbackActive ? (currentStep?.nodeId ?? null) : null}
                  highlight={highlight}
                  visibleIds={visibleIds}
                  collapsed={collapsed}
                  fitKey={`${doc?.key ?? ''}:${activeWorkflow ?? 'overview'}`}
                />
              </Suspense>
              </ErrorBoundary>
            ) : view.nodes.length === 0 ? (
              <div className="centre">Nothing matches the current filters.</div>
            ) : (
              <GraphCanvas
                nodes={view.nodes}
                edges={view.edges}
                positions={view.positions}
                edgePaths={view.edgePaths}
                width={view.width}
                height={view.height}
                groups={view.mode === 'overview' ? view.groups : undefined}
                lanes={view.mode === 'overview' ? view.lanes : undefined}
                steps={view.steps}
                selectedId={focusId}
                onSelect={setSelectedId}
                highlight={highlight}
                fitKey={`${doc?.key ?? ''}:${activeWorkflow ?? 'overview'}`}
                hint={
                  view.mode === 'overview'
                    ? 'Drag to pan, scroll to zoom. Select a node to reveal its connections.'
                    : 'Numbered badges are step order. Dashed = read, thick = write, red = error path.'
                }
              />
            )}
            </div>
            {timeline && timeline.steps.length > 0 ? (
              <PlaybackBar
                timeline={timeline}
                playback={playback}
                onSelectNode={setSelectedId}
                nameOf={(id) => graph.nodes.find((n) => n.id === id)?.name ?? id}
              />
            ) : null}
          </main>

          <DetailPanel
            graph={graph}
            node={selectedNode}
            onSelect={setSelectedId}
            onWorkflow={(id) => setActiveWorkflow(id)}
          />
        </>
      ) : null}
    </div>
  )
}
