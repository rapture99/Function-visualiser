import { useMemo, useRef } from 'react'
import type { Graph, GraphNode } from '../../schema/graph.js'
import { isDrawable } from '../graph/selectors.js'

/**
 * The graph as a real DOM tree.
 *
 * A WebGL canvas is opaque to assistive technology and cannot be fixed with ARIA on the
 * canvas element — so this is not a fallback, it is the accessible peer of the map. Every
 * node is a focusable element, every module can be collapsed from here, and selection is
 * shared with the 2D and 3D views.
 *
 * It also turns out to be the fastest interface for anyone who already knows what they are
 * looking for, which is why it is on screen rather than hidden behind a preference.
 */

export interface StructureTreeProps {
  graph: Graph
  selectedId: string | null
  onSelect: (id: string) => void
  collapsed: ReadonlySet<string>
  onToggle: (module: string) => void
  /** Ids allowed by the current filters; anything else is hidden. */
  visibleIds: ReadonlySet<string>
}

interface Group {
  key: string
  label: string
  members: GraphNode[]
}

export function StructureTree(props: StructureTreeProps) {
  const { graph, selectedId, onSelect, collapsed, onToggle, visibleIds } = props
  const container = useRef<HTMLDivElement>(null)

  const groups = useMemo<Group[]>(() => {
    const byModule = new Map<string, GraphNode[]>()
    for (const node of graph.nodes) {
      if (!isDrawable(node) || !visibleIds.has(node.id)) continue
      const key = node.module ?? ''
      const bucket = byModule.get(key)
      if (bucket) bucket.push(node)
      else byModule.set(key, [node])
    }
    return [...byModule.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0))
      .map(([key, members]) => ({
        key,
        label: key || 'Ungrouped',
        members: members.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      }))
  }, [graph.nodes, visibleIds])

  /**
   * Roving focus across every control in the tree. Arrow keys walk it, Home/End jump to the
   * ends — the behaviour someone navigating without a mouse expects, rather than tabbing
   * through several hundred nodes one at a time.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const focusable = [
      ...(container.current?.querySelectorAll<HTMLElement>('[data-tree-item]') ?? []),
    ]
    if (focusable.length === 0) return

    const index = focusable.indexOf(document.activeElement as HTMLElement)
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(focusable.length - 1, index + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = focusable.length - 1

    const target = focusable[next]
    if (next !== index && target) {
      event.preventDefault()
      target.focus()
    }
  }

  if (groups.length === 0) {
    return <p className="empty">Nothing matches the current filters.</p>
  }

  return (
    <div className="tree" ref={container} onKeyDown={onKeyDown} role="tree" aria-label="Structure">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key || '__ungrouped'} role="treeitem" aria-expanded={!isCollapsed}>
            <button
              type="button"
              data-tree-item
              className="tree-module"
              aria-expanded={!isCollapsed}
              onClick={() => onToggle(group.key)}
            >
              <span className="tree-chevron">{isCollapsed ? '▸' : '▾'}</span>
              {group.label}
              <span className="count">{group.members.length}</span>
            </button>

            {isCollapsed ? null : (
              <div role="group">
                {group.members.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    data-tree-item
                    role="treeitem"
                    className={`tree-node${node.id === selectedId ? ' current' : ''}`}
                    aria-selected={node.id === selectedId}
                    onClick={() => onSelect(node.id)}
                  >
                    <span
                      className="swatch"
                      style={{ background: `var(--layer-${node.layer})` }}
                      aria-hidden="true"
                    />
                    <span className="tree-name">{node.name}</span>
                    <span className="tree-kind">{node.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
