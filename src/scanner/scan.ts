/**
 * Walk a project and collect evidence. Knows nothing about what it will be turned into.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  IGNORED_DIRECTORIES,
  PATH_CONVENTIONS,
  RULES,
  SCANNABLE,
  type Match,
} from './rules.js'

export interface Finding extends Match {
  /** Project-relative, forward-slashed. */
  file: string
  line: number
  ruleId: string
  ruleLabel: string
}

export interface ConventionHit {
  file: string
  kind: Match['kind']
  label: string
  ruleId: string
}

export interface ScanReport {
  root: string
  filesScanned: number
  filesSkipped: number
  findings: Finding[]
  conventions: ConventionHit[]
  /** Extension -> file count, for reporting what the project is made of. */
  languages: Record<string, number>
  truncated: boolean
}

export interface ScanOptions {
  maxFiles?: number
  maxFileBytes?: number
}

function walk(directory: string, out: string[], limit: number): boolean {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return false
  }
  for (const entry of entries.sort()) {
    if (out.length >= limit) return true
    if (IGNORED_DIRECTORIES.has(entry) || (entry.startsWith('.') && entry !== '.')) continue
    const full = join(directory, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      if (walk(full, out, limit)) return true
    } else if (SCANNABLE.test(entry)) {
      out.push(full)
    }
  }
  return false
}

/**
 * Scan several roots as one system.
 *
 * A frontend and its API are routinely separate repositories, and scanned alone neither is
 * complete: the frontend has calls with nothing to match, the backend has routes nobody
 * appears to call. Scanning them together resolves those into real edges. File paths are
 * prefixed with each root's name so provenance stays unambiguous.
 */
export function scanProjects(roots: string[], options: ScanOptions = {}): ScanReport {
  if (roots.length === 1) return scanProject(roots[0]!, options)

  const merged: ScanReport = {
    root: roots.join(', '),
    filesScanned: 0,
    filesSkipped: 0,
    findings: [],
    conventions: [],
    languages: {},
    truncated: false,
  }

  for (const root of roots) {
    const prefix = `${(root.split(/[\\/]/).filter(Boolean).pop() ?? 'root')}/`
    const report = scanProject(root, options)
    merged.filesScanned += report.filesScanned
    merged.filesSkipped += report.filesSkipped
    merged.truncated ||= report.truncated
    for (const [extension, count] of Object.entries(report.languages)) {
      merged.languages[extension] = (merged.languages[extension] ?? 0) + count
    }
    for (const finding of report.findings) {
      merged.findings.push({ ...finding, file: prefix + finding.file })
    }
    for (const hit of report.conventions) {
      merged.conventions.push({ ...hit, file: prefix + hit.file })
    }
  }

  return merged
}

export function scanProject(root: string, options: ScanOptions = {}): ScanReport {
  const { maxFiles = 6000, maxFileBytes = 512 * 1024 } = options

  const files: string[] = []
  const truncated = walk(root, files, maxFiles)

  const findings: Finding[] = []
  const conventions: ConventionHit[] = []
  const languages: Record<string, number> = {}
  let scanned = 0
  let skipped = 0

  for (const absolute of files) {
    const file = relative(root, absolute).split(sep).join('/')
    const extension = (file.split('.').pop() ?? '').toLowerCase()
    languages[extension] = (languages[extension] ?? 0) + 1

    let source: string
    try {
      if (statSync(absolute).size > maxFileBytes) {
        skipped++
        continue
      }
      source = readFileSync(absolute, 'utf8')
    } catch {
      skipped++
      continue
    }
    scanned++

    // Structural evidence: what the file's location and name say it is.
    for (const convention of PATH_CONVENTIONS) {
      if (convention.test.test(file)) {
        conventions.push({
          file,
          kind: convention.kind,
          label: convention.label,
          ruleId: convention.id,
        })
        break // first match wins; the list is ordered most-specific first
      }
    }

    // Declared evidence: what the file actually says.
    const lines = source.split(/\r?\n/)
    for (const rule of RULES) {
      if (!rule.files.test(file)) continue
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (line.length > 600) continue
        const match = rule.pattern.exec(line)
        if (!match) continue
        const built = rule.build(match)
        if (!built) continue
        findings.push({
          ...built,
          file,
          line: i + 1,
          ruleId: rule.id,
          ruleLabel: rule.label,
        })
      }
    }
  }

  return {
    root,
    filesScanned: scanned,
    filesSkipped: skipped,
    findings,
    conventions,
    languages,
    truncated,
  }
}
