/**
 * Scanning a project into draft documents, callable from the CLI or the dev-server API.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { scanProjects, type ScanReport } from './scan.js'
import { buildDraft, renderDraft, slug, splitByFeature, type Draft } from './draft.js'
import { parse } from '../parser/index.js'

/**
 * A catalogue past this size is not reviewable in one sitting, so splitting stops being a
 * preference and becomes the only way the draft ever gets finished. Callers that do not
 * express an opinion get split above this.
 */
export const SPLIT_THRESHOLD = 150

export interface RunScanOptions {
  roots: string[]
  title?: string
  /** Leave undefined to decide from the node count. */
  split?: boolean
  minNodes?: number
  /** File (single) or directory (split). Defaults under docs/apps. */
  out?: string
  docsDir?: string
}

export interface WrittenDocument {
  path: string
  feature?: string
  nodes: number
  errors: number
  warnings: number
}

export interface RunScanResult {
  report: ScanReport
  draft: Draft
  written: WrittenDocument[]
  splitApplied: boolean
  title: string
}

function slugName(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

export function runScan(options: RunScanOptions): RunScanResult {
  const roots = options.roots.map((root) => resolve(root))
  const title = options.title || roots.map((root) => basename(root)).join(' + ')
  const docsDir = options.docsDir ?? 'docs'

  const report = scanProjects(roots)
  if (report.filesScanned === 0) {
    throw new Error(`No scannable source files under ${roots.join(', ')}`)
  }

  const draft = buildDraft(report, title)
  const splitApplied = options.split ?? draft.nodes.length > SPLIT_THRESHOLD
  const written: WrittenDocument[] = []

  if (splitApplied) {
    const parts = splitByFeature(draft, options.minNodes ?? 3)
    const dir = resolve(options.out ?? `${docsDir}/apps/${slugName(title)}`)
    mkdirSync(dir, { recursive: true })
    for (const [feature, part] of parts) {
      const file = resolve(dir, `${slug(feature)}.md`)
      const text = renderDraft(part, report)
      writeFileSync(file, text, 'utf8')
      const parsed = parse(text, file)
      written.push({
        path: file,
        feature,
        nodes: parsed.graph.nodes.length,
        errors: parsed.errorCount,
        warnings: parsed.warningCount,
      })
    }
  } else {
    const file = resolve(options.out ?? `${docsDir}/apps/${slugName(title)}.draft.md`)
    mkdirSync(dirname(file), { recursive: true })
    const text = renderDraft(draft, report)
    writeFileSync(file, text, 'utf8')
    const parsed = parse(text, file)
    written.push({
      path: file,
      nodes: parsed.graph.nodes.length,
      errors: parsed.errorCount,
      warnings: parsed.warningCount,
    })
  }

  return { report, draft, written, splitApplied, title }
}
