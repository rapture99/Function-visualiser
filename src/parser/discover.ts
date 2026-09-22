/**
 * Finding functionality documents on disk.
 *
 * A docs folder holds more than functionality documents — this project's own holds
 * CONVENTION.md and AUTHORING-PROMPT.md, which describe the format rather than using it.
 * Parsing those would produce empty graphs and a `no-content` error every build, so a
 * document has to look like one to be picked up.
 *
 * The test reuses the real scanner rather than a regex, which means fenced code blocks are
 * skipped exactly as they are during parsing. That matters: CONVENTION.md is full of
 * `### Node:` examples inside fences, and a naive regex would treat it as a document.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { scan } from './scan.js'

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vite', 'public', 'venv', '.venv',
])

/** True when the file actually declares nodes or workflows outside of code fences. */
export function looksLikeFunctionalityDoc(source: string): boolean {
  for (const block of scan(source)) {
    if (block.type !== 'heading') continue
    if (block.kind === 'node' || block.kind === 'workflow') return true
  }
  return false
}

export interface Discovered {
  /** Absolute path. */
  path: string
  /** Path relative to the working directory, forward-slashed. */
  relative: string
  /** Stable key derived from the relative path — used for the output filename. */
  key: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Keys become output filenames, so they should read like the document rather than like its
 * path: `hrms-leave.json`, not `docs-apps-hrms-leave.json`. The full path is only used when
 * two documents share a basename, which is the one case where the short form is ambiguous.
 */
function assignKeys(relativePaths: string[]): string[] {
  const basenames = relativePaths.map((path) =>
    slugify((path.split('/').pop() ?? path).replace(/\.md$/i, '')),
  )
  const counts = new Map<string, number>()
  for (const name of basenames) counts.set(name, (counts.get(name) ?? 0) + 1)

  return relativePaths.map((path, index) => {
    const short = basenames[index]!
    if (counts.get(short) === 1) return short
    return slugify(path.replace(/\.md$/i, ''))
  })
}

function walk(directory: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return
  }
  for (const entry of entries.sort()) {
    if (SKIP_DIRECTORIES.has(entry) || entry.startsWith('.')) continue
    const full = join(directory, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, out)
    else if (extname(entry).toLowerCase() === '.md') out.push(full)
  }
}

/**
 * Expand a list of files and/or directories into the functionality documents they contain.
 * Explicitly named files are taken as-is; only directory contents are filtered, because
 * naming a file is an instruction and second-guessing it would be surprising.
 */
export function discover(paths: string[], cwd = process.cwd()): Discovered[] {
  const found: string[] = []

  for (const target of paths) {
    let stats
    try {
      stats = statSync(target)
    } catch {
      throw new Error(`Cannot read ${target}`)
    }

    if (stats.isDirectory()) {
      const candidates: string[] = []
      walk(target, candidates)
      for (const file of candidates) {
        if (looksLikeFunctionalityDoc(readFileSync(file, 'utf8'))) found.push(file)
      }
    } else {
      found.push(target)
    }
  }

  const seen = new Set<string>()
  const unique = found
    .filter((file) => (seen.has(file) ? false : (seen.add(file), true)))
    .map((file) => {
      const rel = relative(cwd, file).split(sep).join('/')
      // A document outside the project reads better as its own absolute path than as a
      // chain of `../..` climbing out of the working directory.
      return { path: file, relative: rel.startsWith('..') ? file.split(sep).join('/') : rel }
    })
    .sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))

  const keys = assignKeys(unique.map((entry) => entry.relative))
  return unique.map((entry, index) => ({ ...entry, key: keys[index]! }))
}
