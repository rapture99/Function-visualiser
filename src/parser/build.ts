#!/usr/bin/env node
/**
 * Parse every functionality document under one or more paths and emit a manifest.
 *
 *   tsx src/parser/build.ts [path...] [-o public/graphs] [--manifest public/documents.json]
 *
 * Point it at a file, a folder, or several of either — including folders outside this
 * project. The viewer reads the manifest rather than a hardcoded list, so whatever this
 * finds is what shows up in the document picker.
 */

import { buildDocuments, type ManifestEntry } from './buildDocuments.js'
import { formatDiagnostic } from './diagnostics.js'

interface Options {
  paths: string[]
  outDir: string
  manifest: string
  strict: boolean
  quiet: boolean
}

function parseArgs(argv: string[]): Options | null {
  const options: Options = {
    paths: [],
    outDir: 'public/graphs',
    manifest: 'public/documents.json',
    strict: false,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-o' || arg === '--out') options.outDir = argv[++i] ?? options.outDir
    else if (arg === '--manifest') options.manifest = argv[++i] ?? options.manifest
    else if (arg === '--strict') options.strict = true
    else if (arg === '-q' || arg === '--quiet') options.quiet = true
    else if (arg === '-h' || arg === '--help') return null
    else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`)
      return null
    } else options.paths.push(arg)
  }
  if (options.paths.length === 0) options.paths = ['docs']
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    console.error(
      [
        'Usage: build [path...] [-o <dir>] [--manifest <file>] [--strict] [--quiet]',
        '',
        '  path        Files or folders to scan. Default: docs',
        '  -o, --out   Where to write one JSON per document. Default: public/graphs',
        '  --manifest  Where to write the document index. Default: public/documents.json',
        '  --strict    Exit non-zero on warnings as well as errors',
      ].join('\n'),
    )
    process.exit(2)
  }

  let result
  try {
    result = buildDocuments({
      paths: options.paths,
      outDir: options.outDir,
      manifest: options.manifest,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }

  const entries: ManifestEntry[] = result.entries
  const totalErrors = result.errors
  const totalWarnings = result.warnings

  if (entries.length === 0) {
    console.error(
      `No functionality documents found in: ${options.paths.join(', ')}
` +
        'A document must declare at least one `### Node:` or `## Workflow:` outside a code fence.',
    )
    process.exit(2)
  }

  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic))

  if (!options.quiet) {
    console.error('')
    for (const entry of entries) {
      console.error(
        `${entry.source.padEnd(38)} ${String(entry.nodes).padStart(4)} nodes  ` +
          `${String(entry.workflows).padStart(2)} wf  ` +
          `${entry.errors} err  ${entry.warnings} warn  ${entry.scope}`,
      )
    }
    console.error(
      `\n${entries.length} document(s) -> ${options.outDir}, index -> ${options.manifest}` +
        `\n${totalErrors} error(s), ${totalWarnings} warning(s)`,
    )
  }

  process.exit(totalErrors > 0 || (options.strict && totalWarnings > 0) ? 1 : 0)
}


main()
