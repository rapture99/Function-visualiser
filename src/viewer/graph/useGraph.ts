import { useCallback, useEffect, useState } from 'react'
import { parseGraph, type Graph } from '../../schema/graph.js'
import { host, type ManifestEntry } from '../host.js'

export interface DocumentStats {
  nodes: number
  edges: number
  workflows: number
  errors: number
  warnings: number
}

export interface DocumentSource {
  key: string
  label: string
  scope: string
  /** The Markdown file this came from, for display. */
  source?: string
  /** Where to fetch the graph. Absent for documents parsed in the browser. */
  url?: string
  /** Already-parsed graph, for documents dropped onto the page. */
  graph?: Graph
  stats?: DocumentStats
  origin: 'manifest' | 'dropped'
  /** Bumped on every live reindex, so a regenerated graph is refetched even when its
   *  node and edge counts happen to be identical. */
  revision?: number
}

export function toDocumentSources(
  entries: ManifestEntry[],
  revision?: number,
): DocumentSource[] {
  return entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    scope: entry.scope,
    source: entry.source,
    url: entry.url,
    origin: 'manifest' as const,
    ...(revision === undefined ? {} : { revision }),
    stats: {
      nodes: entry.nodes,
      edges: entry.edges,
      workflows: entry.workflows,
      errors: entry.errors,
      warnings: entry.warnings,
    },
  }))
}

export type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; documents: DocumentSource[] }
  | { status: 'error'; message: string }

export interface ManifestControl {
  state: ManifestState
  /** Replace the indexed list after the server rebuilt it. */
  set: (documents: DocumentSource[]) => void
}

/**
 * The document list comes from `public/documents.json`, written by `npm run parse`, rather
 * than from a hardcoded array. Point the build at any file or folder and whatever it finds
 * shows up here — nothing in the viewer needs to know which documents exist.
 */
export function useDocuments(): ManifestControl {
  const [state, setState] = useState<ManifestState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    host()
      .loadDocuments()
      .then((entries) => {
        if (cancelled) return
        setState({ status: 'ready', documents: toDocumentSources(entries) })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const set = useCallback(
    (documents: DocumentSource[]) => setState({ status: 'ready', documents }),
    [],
  )

  // Live sync: the host reindexes whenever a document changes on disk and pushes the new
  // index. Only the data is replaced — selection, filters, collapse state, playback position
  // and camera are React state and survive untouched, which is the entire point.
  useEffect(() => host().onDocuments((entries) => set(toDocumentSources(entries, Date.now()))), [set])

  return { state, set }
}

export type GraphState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; graph: Graph }
  | { status: 'error'; message: string }

/** Resolve a document to its graph — from memory when it was parsed here, else over HTTP. */
export function useGraphFor(document: DocumentSource | null): GraphState {
  const [state, setState] = useState<GraphState>({ status: 'idle' })

  useEffect(() => {
    if (!document) {
      setState({ status: 'idle' })
      return
    }

    if (document.graph) {
      setState({ status: 'ready', graph: document.graph })
      return
    }

    if (!document.url) {
      setState({ status: 'error', message: 'Document has neither a graph nor a URL.' })
      return
    }

    let cancelled = false
    // Keep showing the current graph while a newer one loads: blanking the map on every save
    // is exactly the flicker live sync exists to avoid.
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }))

    host()
      .loadGraph({ url: document.url, ...(document.revision ? { revision: document.revision } : {}) })
      // Validated against the same zod schema the parser writes with. If this ever throws,
      // the contract has drifted — which is exactly what we want to hear about loudly.
      .then((json) => parseGraph(json))
      .then((graph) => {
        if (!cancelled) setState({ status: 'ready', graph })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setState({ status: 'error', message: `Could not load ${document.url} — ${message}` })
      })

    return () => {
      cancelled = true
    }
  }, [document])

  return state
}

/** Documents parsed in the browser this session. */
export function useDroppedDocuments() {
  const [dropped, setDropped] = useState<DocumentSource[]>([])

  const add = useCallback((documents: DocumentSource[]) => {
    setDropped((current) => {
      const byKey = new Map(current.map((d) => [d.key, d]))
      for (const document of documents) byKey.set(document.key, document)
      return [...byKey.values()]
    })
  }, [])

  const clear = useCallback(() => setDropped([]), [])

  return { dropped, add, clear }
}
