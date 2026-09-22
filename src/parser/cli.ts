#!/usr/bin/env node
/**
 * Headless parser CLI.
 *
 *   tsx src/parser/cli.ts <input.md> -o public/graphs/out.json [--strict] [--quiet]
 *
 * Exits 1 when the document has errors (or, with --strict, any warnings) so this can gate
 * a build. Kept free of any renderer import: the parser must run without a browser.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve as resolvePath } from 'node:path'
import { parse } from './index.js'
import { formatDiagnostic } from './diagnostics.js'

interface Options {
  input: string
  output?: string
  strict: boolean
  quiet: boolean
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = { input: '', strict: false, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-o' || arg === '--out' || arg === '--output') opts.output = argv[++i]
    else if (arg === '--strict') opts.strict = true
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true
    else if (arg === '-h' || arg === '--help') return null
    else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`)
      return null
    } else if (!opts.input) opts.input = arg
  }
  return opts.input ? opts : null
}

function usage() {
  console.error(
    [
      'Usage: parse <input.md> [-o <output.json>] [--strict] [--quiet]',
      '',
      '  -o, --out    Write graph JSON to this path (default: stdout)',
      '  --strict     Exit non-zero on warnings as well as errors',
      '  -q, --quiet  Only print diagnostics, not the summary',
    ].join('\n'),
  )
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts) {
    usage()
    process.exit(2)
  }

  const absolute = resolvePath(process.cwd(), opts.input)
  let source: string
  try {
    source = readFileSync(absolute, 'utf8')
  } catch {
    console.error(`Cannot read ${opts.input}`)
    process.exit(2)
  }

  // The graph records the relative path so output stays machine-independent and
  // byte-stable across checkouts — hot reload diffs two graphs, so noise is expensive.
  const relPath = relative(process.cwd(), absolute).split('\\').join('/')
  const result = parse(source, relPath)

  for (const d of result.diagnostics) console.error(formatDiagnostic(d))

  const json = JSON.stringify(result.graph, null, 2)
  if (opts.output) {
    const target = resolvePath(process.cwd(), opts.output)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, json + '\n', 'utf8')
  } else {
    process.stdout.write(json + '\n')
  }

  if (!opts.quiet) {
    const { nodes, edges, workflows } = result.graph
    console.error(
      [
        '',
        `${nodes.length} nodes, ${edges.length} edges, ${workflows.length} workflows`,
        `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
        opts.output ? `-> ${opts.output}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  const failed = result.errorCount > 0 || (opts.strict && result.warningCount > 0)
  process.exit(failed ? 1 : 0)
}

main()
