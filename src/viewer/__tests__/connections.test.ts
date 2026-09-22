import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../../parser/index.js'
import { connectionsOf, groupConnections } from '../graph/selectors.js'
import type { GraphEdge } from '../../schema/graph.js'

const graph = parse(
  readFileSync(
    fileURLToPath(new URL('../../testing/fixtures/sample-system.md', import.meta.url)),
    'utf8',
  ),
  'sample-system.md',
).graph

describe('groupConnections', () => {
  it('shows a connection two workflows share once, naming both', () => {
    // Both workflows reach the approvals page from the admin, so there are two edges.
    const raw = connectionsOf(graph, 'approve-leave-page').incoming.filter((e) => e.from === 'admin')
    expect(raw).toHaveLength(2)

    const grouped = groupConnections(graph, raw, 'in')
    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.nodeId).toBe('admin')
    expect(grouped[0]!.workflows.sort()).toEqual(['Apply for leave', 'Reject a leave request'])
    expect(grouped[0]!.edgeIds).toHaveLength(2)
  })

  it('never lists the same (kind, node) pair twice', () => {
    for (const node of graph.nodes) {
      const { incoming, outgoing } = connectionsOf(graph, node.id)
      for (const [edges, direction] of [[incoming, 'in'], [outgoing, 'out']] as const) {
        const keys = groupConnections(graph, edges, direction).map((g) => `${g.kind}|${g.nodeId}`)
        expect(new Set(keys).size, `${node.id} ${direction}`).toBe(keys.length)
      }
    }
  })

  it('keeps a declared dependency, which belongs to no workflow', () => {
    const outgoing = groupConnections(graph, connectionsOf(graph, 'leave-service').outgoing, 'out')
    const dependency = outgoing.find((g) => g.kind === 'depends' && g.nodeId === 'notification-service')!
    expect(dependency).toBeTruthy()
    expect(dependency.workflows).toEqual([])
  })

  it('keeps different kinds of connection to the same node apart', () => {
    const edges: GraphEdge[] = [
      { id: 'a', from: 'x', to: 'y', kind: 'reads', source: { file: 'f', line: 1 } },
      { id: 'b', from: 'x', to: 'y', kind: 'writes', source: { file: 'f', line: 2 } },
      { id: 'c', from: 'x', to: 'y', kind: 'reads', source: { file: 'f', line: 3 } },
    ]
    const grouped = groupConnections(graph, edges, 'out')
    expect(grouped.map((g) => `${g.kind}:${g.edgeIds.length}`)).toEqual(['reads:2', 'writes:1'])
  })

  it('collects each distinct guard condition once', () => {
    const edges: GraphEdge[] = [
      { id: 'a', from: 'x', to: 'y', kind: 'calls', condition: 'approved', source: { file: 'f', line: 1 } },
      { id: 'b', from: 'x', to: 'y', kind: 'calls', condition: 'approved', source: { file: 'f', line: 2 } },
      { id: 'c', from: 'x', to: 'y', kind: 'calls', condition: 'same department', source: { file: 'f', line: 3 } },
    ]
    expect(groupConnections(graph, edges, 'out')[0]!.conditions).toEqual(['approved', 'same department'])
  })
})
