/**
 * Indexing documents into `public/graphs/*.json` plus a manifest.
 *
 * Extracted from the CLI so the dev-server API can do exactly the same work. There is one
 * implementation of "what does indexing mean", and the button in the UI and the command line
 * cannot drift apart.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse } from './index.js'
import { discover } from './discover.js'
import type { Diagnostic } from '../schema/graph.js'

export interface ManifestEntry {
  key: string
  label: string
  scope: string
  /** Relative to the site root. */
  url: string
  source: string
  nodes: number
  edges: number
  workflows: number
  errors: number
  warnings: number
}

export interface BuildOptions {
  /** Files and/or folders to index. */
  paths: string[]
  outDir: string
  manifest: string
  cwd?: string
}

export interface BuildResult {
  entries: ManifestEntry[]
  diagnostics: Diagnostic[]
  errors: number
  warnings: number
}

/** Path of outDir as seen from the manifest's own directory. */
export function relativeUrl(manifestPath: string, outDir: string): string {
  const manifestDir = dirname(resolve(manifestPath))
  const out = resolve(outDir)
  if (out.startsWith(manifestDir)) {
    return out.slice(manifestDir.length).replace(/^[\\/]/, '').split('\\').join('/') || '.'
  }
  return outDir.split('\\').join('/')
}

export function buildDocuments(options: BuildOptions): BuildResult {
  const { paths, outDir, manifest, cwd = process.cwd() } = options
  const documents = discover(paths, cwd)

  mkdirSync(resolve(outDir), { recursive: true })

  const entries: ManifestEntry[] = []
  const diagnostics: Diagnostic[] = []
  let errors = 0
  let warnings = 0

  for (const document of documents) {
    const result = parse(readFileSync(document.path, 'utf8'), document.relative)
    diagnostics.push(...result.diagnostics)
    errors += result.errorCount
    warnings += result.warningCount

    const file = `${document.key}.json`
    writeFileSync(
      resolve(outDir, file),
      `${JSON.stringify(result.graph, null, 2)}\n`,
      'utf8',
    )

    entries.push({
      key: document.key,
      label: result.graph.meta.title ?? document.relative,
      scope: result.graph.meta.scope,
      url: `${relativeUrl(manifest, outDir)}/${file}`,
      source: document.relative,
      nodes: result.graph.nodes.length,
      edges: result.graph.edges.length,
      workflows: result.graph.workflows.length,
      errors: result.errorCount,
      warnings: result.warningCount,
    })
  }

  mkdirSync(dirname(resolve(manifest)), { recursive: true })
  writeFileSync(resolve(manifest), `${JSON.stringify({ documents: entries }, null, 2)}\n`, 'utf8')

  return { entries, diagnostics, errors, warnings }
}
