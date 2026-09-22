import type { Graph, GraphNode } from '../../schema/graph.js'
import type { Layer } from '../../schema/kinds.js'
import { isDrawable, layersPresent, rolesPresent } from '../graph/selectors.js'
import { StructureTree } from './StructureTree.js'

const LAYER_LABEL: Record<Layer, string> = {
  actor: 'Actors',
  interface: 'Interface',
  logic: 'Logic',
  data: 'Data',
  external: 'External',
}

export interface SidebarProps {
  graph: Graph
  activeWorkflow: string | null
  onWorkflow: (id: string | null) => void
  layers: ReadonlySet<Layer>
  onToggleLayer: (layer: Layer) => void
  roles: ReadonlySet<string>
  onToggleRole: (role: string) => void
  query: string
  onQuery: (value: string) => void
  matches: GraphNode[]
  onSelect: (id: string) => void
  selectedId: string | null
  collapsed: ReadonlySet<string>
  onToggleModule: (module: string) => void
  onCollapseAll: () => void
  onExpandAll: () => void
  visibleIds: ReadonlySet<string>
}

export function Sidebar(props: SidebarProps) {
  const {
    graph, activeWorkflow, onWorkflow, layers, onToggleLayer,
    roles, onToggleRole, query, onQuery, matches, onSelect,
    selectedId, collapsed, onToggleModule, onCollapseAll, onExpandAll, visibleIds,
  } = props

  const availableLayers = layersPresent(graph)
  const availableRoles = rolesPresent(graph)
  const perLayer = (layer: Layer) =>
    graph.nodes.filter((n) => isDrawable(n) && n.layer === layer).length

  return (
    <aside className="side">
      <div className="group">
        <h2>View</h2>
        <button
          type="button"
          className="item"
          aria-current={activeWorkflow === null}
          onClick={() => onWorkflow(null)}
        >
          Overview
          <span className="sub">
            {graph.nodes.filter(isDrawable).length} nodes across {availableLayers.length} layers
          </span>
        </button>
      </div>

      <div className="group">
        <h2>Workflows</h2>
        {graph.workflows.length === 0 ? (
          // Almost always a scanner draft. Saying "none" without saying why leaves people
          // hunting for a broken feature instead of the missing authoring step.
          <p className="empty">
            No workflows in this document — so there are no flows to follow, only the node
            inventory and whatever dependencies could be established.
            <br />
            <br />
            Workflows describe intent, which a scan cannot recover from source. Use{' '}
            <strong>Copy prompt</strong> in the header, paste it into Claude Code inside the
            repo, and it will trace them from the code.
          </p>
        ) : (
          graph.workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              className="item"
              aria-current={activeWorkflow === workflow.id}
              onClick={() => onWorkflow(workflow.id)}
            >
              {workflow.name}
              <span className="sub">
                {workflow.steps.length} steps
                {workflow.roles.length > 0 ? ` · ${workflow.roles.join(', ')}` : ''}
                {workflow.errors.length > 0 ? ` · ${workflow.errors.length} error paths` : ''}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="group">
        <h2>Search</h2>
        <input
          className="search"
          type="search"
          placeholder="name, id, module, file…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label="Search nodes"
        />
        {query ? (
          matches.length === 0 ? (
            <p className="empty">No matches.</p>
          ) : (
            <div style={{ marginTop: 6 }}>
              {matches.slice(0, 12).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="item"
                  onClick={() => onSelect(node.id)}
                >
                  {node.name}
                  <span className="sub">
                    {node.kind}
                    {node.module ? ` · ${node.module}` : ''}
                  </span>
                </button>
              ))}
              {matches.length > 12 ? (
                <p className="empty">+{matches.length - 12} more</p>
              ) : null}
            </div>
          )
        ) : null}
      </div>

      <div className="group">
        <div className="group-head">
          <h2>Structure</h2>
          <span className="group-actions">
            <button type="button" className="link" onClick={onCollapseAll}>
              collapse all
            </button>
            <button type="button" className="link" onClick={onExpandAll}>
              expand all
            </button>
          </span>
        </div>
        <StructureTree
          graph={graph}
          selectedId={selectedId}
          onSelect={onSelect}
          collapsed={collapsed}
          onToggle={onToggleModule}
          visibleIds={visibleIds}
        />
      </div>

      <div className="group">
        <h2>Layers</h2>
        {availableLayers.map((layer) => (
          <label key={layer} className="check">
            <input
              type="checkbox"
              checked={layers.has(layer)}
              onChange={() => onToggleLayer(layer)}
            />
            <span className="swatch" style={{ background: `var(--layer-${layer})` }} />
            {LAYER_LABEL[layer]}
            <span className="count">{perLayer(layer)}</span>
          </label>
        ))}
      </div>

      {availableRoles.length > 0 ? (
        <div className="group">
          <h2>Roles</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {availableRoles.map((role) => (
              <button
                key={role}
                type="button"
                className="pill"
                aria-pressed={roles.has(role)}
                onClick={() => onToggleRole(role)}
              >
                {role}
              </button>
            ))}
          </div>
          <p className="empty" style={{ fontSize: 11.5, marginTop: 6 }}>
            Filters by which roles actually reach a node through a workflow, not by what a
            node declares.
          </p>
        </div>
      ) : null}
    </aside>
  )
}
