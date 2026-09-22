import type { Graph, GraphNode } from '../../schema/graph.js'
import { connectionsOf, groupConnections, type ConnectionGroup } from '../graph/selectors.js'
import { host } from '../host.js'

/** `src/a/b.ts:42`, `src/a/b.ts`, `back\x.js:9` — the shapes evidence metadata actually takes. */
const SOURCE_REF = /^([\w./\\@-]+\.\w{1,6})(?::(\d+))?$/

/**
 * Evidence is only worth writing down if it can be checked, and in an editor "checked" should
 * mean one click rather than a copied string. Falls back to plain text wherever there is no
 * editor to jump to.
 */
function SourceRef({ value }: { value: string }) {
  const open = host().openSource
  const match = SOURCE_REF.exec(value.trim())
  if (!open || !match) return <code>{value}</code>

  const file = match[1]!
  const line = match[2] ? Number(match[2]) : 1
  return (
    <button type="button" className="source-link" onClick={() => open(file, line)} title={`Open ${value}`}>
      {value}
    </button>
  )
}

/** Which flows use a connection, and under what condition: once, not once per edge. */
function ConnectionSub({ group }: { group: ConnectionGroup }) {
  if (group.workflows.length === 0 && group.conditions.length === 0) return null
  return (
    <span className="conn-sub">
      {group.workflows.join(' \u00b7 ')}
      {group.conditions.length > 0 ? ` \u2014 when ${group.conditions.join(' / ')}` : ''}
    </span>
  )
}

export interface DetailPanelProps {
  graph: Graph
  node: GraphNode | null
  onSelect: (id: string) => void
  onWorkflow: (id: string) => void
}

export function DetailPanel({ graph, node, onSelect, onWorkflow }: DetailPanelProps) {
  if (!node) {
    return (
      <aside className="detail">
        <p className="empty">
          Select a node to see what it is, where it lives, and what connects to it.
        </p>
      </aside>
    )
  }

  const connections = connectionsOf(graph, node.id)
  const incoming = groupConnections(graph, connections.incoming, 'in')
  const outgoing = groupConnections(graph, connections.outgoing, 'out')
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id
  const metaEntries = Object.entries(node.meta)

  return (
    <aside className="detail">
      <h2>{node.name}</h2>
      <p className="kind">
        <span style={{ color: `var(--layer-${node.layer})` }}>{node.kind}</span>
        {' · '}
        {node.layer}
        {node.module ? ` · ${node.module}` : ''}
      </p>

      {node.description ? <p style={{ marginTop: 0 }}>{node.description}</p> : null}

      <h3>Identity</h3>
      <dl className="kv">
        <dt>id</dt>
        <dd>
          <code>{node.id}</code>
        </dd>
        <dt>source</dt>
        <dd>
          <SourceRef value={`${node.source.file}:${node.source.line}`} />
        </dd>
        {node.implicit ? (
          <>
            <dt>created</dt>
            <dd>by the parser, not declared in the document</dd>
          </>
        ) : null}
      </dl>

      {metaEntries.length > 0 ? (
        <>
          <h3>Details</h3>
          <dl className="kv">
            {metaEntries.map(([key, value]) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt>{key}</dt>
                <dd>
                  <SourceRef value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {node.workflows.length > 0 ? (
        <>
          <h3>Workflows</h3>
          {node.workflows.map((id) => (
            <button key={id} type="button" className="conn" onClick={() => onWorkflow(id)}>
              {graph.workflows.find((w) => w.id === id)?.name ?? id}
            </button>
          ))}
        </>
      ) : null}

      {node.rolesReached.length > 0 ? (
        <>
          <h3>Roles that reach it</h3>
          <div>
            {node.rolesReached.map((role) => (
              <span key={role} className="tag">
                {role}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {node.roles.length > 0 ? (
        <>
          <h3>Declared roles</h3>
          <div>
            {node.roles.map((role) => (
              <span key={role} className="tag">
                {role}
              </span>
            ))}
          </div>
        </>
      ) : null}

      <h3>Incoming ({incoming.length})</h3>
      {incoming.length === 0 ? (
        <p className="empty">Nothing reaches this node.</p>
      ) : (
        incoming.map((group) => (
          <button key={group.edgeIds[0]} type="button" className="conn" onClick={() => onSelect(group.nodeId)}>
            <span className="rel">{group.kind}</span>
            {nameOf(group.nodeId)}
            <ConnectionSub group={group} />
          </button>
        ))
      )}

      <h3>Outgoing ({outgoing.length})</h3>
      {outgoing.length === 0 ? (
        <p className="empty">This node leads nowhere.</p>
      ) : (
        outgoing.map((group) => (
          <button key={group.edgeIds[0]} type="button" className="conn" onClick={() => onSelect(group.nodeId)}>
            <span className="rel">{group.kind}</span>
            {nameOf(group.nodeId)}
            <ConnectionSub group={group} />
          </button>
        ))
      )}
    </aside>
  )
}
