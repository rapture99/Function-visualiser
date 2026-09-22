/**
 * Markdown -> graph.json.
 *
 *   scan()     text     -> line-numbered blocks
 *   extract()  blocks   -> raw IR (what the author literally wrote)
 *   resolve()  raw IR   -> validated graph (references, edges, derived fields)
 *
 * Never throws on bad input. A malformed document produces a partial graph plus
 * diagnostics, because the authoring loop needs to keep rendering while you type.
 */

import { scan } from './scan.js'
import { extract } from './extract.js'
import { resolve } from './resolve.js'
import { DiagnosticBag } from './diagnostics.js'
import type { Diagnostic, Graph } from '../schema/graph.js'

export interface ParseResult {
  graph: Graph
  diagnostics: Diagnostic[]
  errorCount: number
  warningCount: number
}

export function parse(source: string, file = 'functionality.md'): ParseResult {
  const diag = new DiagnosticBag(file)
  const graph = resolve(extract(scan(source), diag), file, diag)
  // Report in document order rather than in the order the passes happened to emit —
  // the author is reading their file top to bottom. Stable, so output stays reproducible.
  diag.items.sort((a, b) => a.line - b.line)
  return {
    graph,
    diagnostics: diag.items,
    errorCount: diag.errorCount,
    warningCount: diag.warningCount,
  }
}

export { scan } from './scan.js'
export { extract } from './extract.js'
export { resolve } from './resolve.js'
export { CODES, formatDiagnostic } from './diagnostics.js'
