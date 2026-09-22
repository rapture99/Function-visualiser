/**
 * Client for the dev-server document API.
 *
 * Only exists while `npm run dev` is running — a built site is static files with no backend,
 * so every call site has to cope with `available` being false rather than assuming a server.
 */

import type { DocumentSource } from './graph/useGraph.js'
import { host } from './host.js'

/** Whether this host can add and remove documents at all. */
export const available = host().canManage

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
  /** Omit to let the server decide from the node count. */
  split?: boolean
  minNodes?: number
}

export interface WrittenDocument {
  path: string
  feature?: string
  nodes: number
  errors: number
  warnings: number
}

export interface ScanResponse {
  documents: ManifestEntry[]
  splitApplied: boolean
  title: string
  filesScanned: number
  nodesFound: number
  written: WrittenDocument[]
}


export const scan = (request: ScanRequest) => host().scan(request)
export const reindex = () => host().reindex()
export const remove = (source: string) => host().remove(source)

/** Manifest entries as the viewer's document type. */
export function toDocuments(entries: ManifestEntry[]): DocumentSource[] {
  return entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    scope: entry.scope,
    source: entry.source,
    url: entry.url,
    origin: 'manifest' as const,
    stats: {
      nodes: entry.nodes,
      edges: entry.edges,
      workflows: entry.workflows,
      errors: entry.errors,
      warnings: entry.warnings,
    },
  }))
}
