/**
 * Where the viewer gets its data and what it can ask for.
 *
 * The viewer runs in three places now — a Vite dev server, a static `serve`, and a VS Code
 * webview — and only the first two speak HTTP. Rather than sprinkling `typeof fetch` checks
 * around, every capability the viewer needs from its surroundings is declared here and
 * implemented once per environment.
 *
 * It also lets a host offer things the web cannot. `openSource` is the reason the extension
 * exists: every node already carries a `file:line`, and in an editor that can be a jump to
 * the code rather than a string to copy.
 */

import type { Graph } from '../schema/graph.js'

export interface ManifestEntry {
  key: string
  label: string
  scope: string
  url: string
  source: string
  nodes: number
  edges: number
  workflows: number
  errors: number
  warnings: number
}

export interface ScanRequest {
  paths: string[]
  title?: string
  split?: boolean
  minNodes?: number
}

export interface ScanResult {
  documents: ManifestEntry[]
  splitApplied: boolean
  title: string
  filesScanned: number
  nodesFound: number
  written: Array<{ path: string; feature?: string; nodes: number; errors: number; warnings: number }>
}

export interface Host {
  /** How the viewer describes itself, for capability hints in the UI. */
  readonly kind: 'web' | 'vscode'
  /** Whether documents can be added and removed here. */
  readonly canManage: boolean
  loadDocuments(): Promise<ManifestEntry[]>
  loadGraph(entry: { url: string; revision?: number }): Promise<Graph>
  scan(request: ScanRequest): Promise<ScanResult>
  reindex(): Promise<{ documents: ManifestEntry[]; errors: number; warnings: number }>
  remove(source: string): Promise<{ documents: ManifestEntry[]; movedTo: string }>
  /** Subscribe to index changes pushed by the host. Returns an unsubscribe. */
  onDocuments(listener: (documents: ManifestEntry[]) => void): () => void
  /** Reveal a node's evidence in an editor. Absent where there is no editor. */
  openSource?(file: string, line: number): void
}

// ---------------------------------------------------------------------------- web

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`/__api${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `${response.status} ${response.statusText}`)
  return payload as T
}

function createWebHost(): Host {
  return {
    kind: 'web',
    // The dev server and `serve` both expose the API; a plain static build does not, and
    // finds out by failing, which is why every management call surfaces its error.
    canManage: true,

    async loadDocuments() {
      const response = await fetch('documents.json')
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return ((await response.json()) as { documents: ManifestEntry[] }).documents
    },

    async loadGraph(entry) {
      // Cache-bust on revision so a regenerated graph is re-read rather than served stale.
      const url = entry.revision ? `${entry.url}?v=${entry.revision}` : entry.url
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return (await response.json()) as Graph
    },

    scan: (request) => post<ScanResult>('/scan', request),
    reindex: () => post('/reindex', {}),
    remove: (source) => post('/remove', { source }),

    onDocuments(listener) {
      const hot = import.meta.hot
      if (!hot) return () => {}
      const handler = (payload: { documents: ManifestEntry[] }) => {
        if (payload?.documents) listener(payload.documents)
      }
      hot.on('flow-visualizer:documents', handler)
      return () => hot.off('flow-visualizer:documents', handler)
    },
  }
}

// ---------------------------------------------------------------------------- vscode

interface VsCodeApi {
  postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * A webview cannot fetch the workspace, so every request is a message to the extension host
 * and every reply comes back on the same channel, matched by id.
 */
function createVsCodeHost(): Host {
  const api = acquireVsCodeApi()
  const pending = new Map<number, Pending>()
  const listeners = new Set<(documents: ManifestEntry[]) => void>()
  let nextId = 1

  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as
      | { id: number; ok: true; result: unknown }
      | { id: number; ok: false; error: string }
      | { event: 'documents'; documents: ManifestEntry[] }
      | undefined
    if (!message) return

    if ('event' in message && message.event === 'documents') {
      for (const listener of listeners) listener(message.documents)
      return
    }
    if (!('id' in message)) return

    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.ok) waiting.resolve(message.result)
    else waiting.reject(new Error(message.error))
  })

  const request = <T,>(type: string, payload?: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      api.postMessage({ id, type, payload })
    })

  return {
    kind: 'vscode',
    canManage: true,
    loadDocuments: () => request<ManifestEntry[]>('loadDocuments'),
    loadGraph: (entry) => request<Graph>('loadGraph', { key: entry.url }),
    scan: (scanRequest) => request<ScanResult>('scan', scanRequest),
    reindex: () => request('reindex'),
    remove: (source) => request('remove', { source }),
    onDocuments(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    openSource(file, line) {
      api.postMessage({ type: 'openSource', payload: { file, line } })
    },
  }
}

let cached: Host | undefined

export function host(): Host {
  if (!cached) {
    cached = typeof acquireVsCodeApi === 'function' ? createVsCodeHost() : createWebHost()
  }
  return cached
}
