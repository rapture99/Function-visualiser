import type { Diagnostic, Severity } from '../schema/graph.js'

/**
 * Every diagnostic the parser can emit. Codes are stable — the viewer keys off them,
 * and tests assert on them rather than on message wording.
 */
export const CODES = {
  // structure
  NO_CONTENT: 'no-content',
  INVALID_ID: 'invalid-node-id',
  DUPLICATE_NODE: 'duplicate-node-id',
  DUPLICATE_WORKFLOW: 'duplicate-workflow-id',
  MISSING_TYPE: 'missing-type',
  UNKNOWN_TYPE: 'unknown-type',
  // references
  UNKNOWN_NODE_REF: 'unknown-node-ref',
  UNKNOWN_DEPENDENCY: 'unknown-dependency',
  SELF_LOOP: 'self-loop',
  REPEATED_STEP: 'repeated-step',
  // ambiguity — the "don't silently invent relationships" family
  AMBIGUOUS_DATA_ACCESS: 'ambiguous-data-access',
  UNKNOWN_ANNOTATION: 'unknown-annotation',
  // syntax
  INVALID_STEP: 'invalid-step-syntax',
  INVALID_ERROR: 'invalid-error-syntax',
  STRAY_CONTENT: 'stray-content',
  // graph health
  EMPTY_WORKFLOW: 'empty-workflow',
  ORPHAN_NODE: 'orphan-node',
} as const

export class DiagnosticBag {
  readonly items: Diagnostic[] = []

  constructor(private readonly file: string) {}

  private push(severity: Severity, code: string, line: number, message: string, hint?: string) {
    this.items.push({ severity, code, message, file: this.file, line, ...(hint ? { hint } : {}) })
  }

  error(code: string, line: number, message: string, hint?: string) {
    this.push('error', code, line, message, hint)
  }

  warn(code: string, line: number, message: string, hint?: string) {
    this.push('warning', code, line, message, hint)
  }

  info(code: string, line: number, message: string, hint?: string) {
    this.push('info', code, line, message, hint)
  }

  get errorCount() {
    return this.items.filter((d) => d.severity === 'error').length
  }

  get warningCount() {
    return this.items.filter((d) => d.severity === 'warning').length
  }
}

/** Levenshtein distance, capped — only used to build "did you mean" hints. */
function distance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 3) return 99
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    prev = cur
  }
  return prev[n]!
}

/** Closest candidate within a small edit distance, for actionable hints. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.trim().toLowerCase()
  let best: string | undefined
  let bestScore = 3
  for (const c of candidates) {
    const d = distance(needle, c.toLowerCase())
    if (d < bestScore) {
      bestScore = d
      best = c
    }
  }
  return best
}

/** Human-readable diagnostic block for the CLI. */
export function formatDiagnostic(d: Diagnostic): string {
  const head = `${d.severity.toUpperCase().padEnd(7)} ${d.file}:${d.line}  [${d.code}]`
  const body = `        ${d.message}`
  return d.hint ? `${head}\n${body}\n        hint: ${d.hint}` : `${head}\n${body}`
}
