#!/usr/bin/env node
/**
 * flow-visualizer — one entry point for the installed package.
 *
 *   flow-visualizer scan <path...>     draft documents from a codebase
 *   flow-visualizer parse [path...]    index Markdown documents into graphs
 *   flow-visualizer serve              open the viewer on the indexed documents
 *
 * Every subcommand delegates to the same functions the development checkout uses, so an
 * installed copy cannot drift from the one this was built in.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDocuments } from '../parser/buildDocuments.js'
import { formatDiagnostic } from '../parser/diagnostics.js'
import { runScan } from '../scanner/runScan.js'
import { serve } from './serve.js'

const here = dirname(fileURLToPath(import.meta.url))

/** The built viewer, whether running from `dist/` or from a source checkout. */
function findWebRoot(): string {
  const candidates = [
    resolve(here, '../../web'), // installed: dist/node/cli -> dist/web
    resolve(here, '../web'), // flatter layouts
    resolve(here, '../../dist/web'), // source checkout: src/cli -> dist/web
    resolve(process.cwd(), 'dist/web'),
  ]
  return candidates.find((path) => existsSync(resolve(path, 'index.html'))) ?? candidates[0]!
}

function version(): string {
  for (const path of [resolve(here, '../../package.json'), resolve(here, '../../../package.json')]) {
    try {
      return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? '0.0.0'
    } catch {
      // try the next candidate
    }
  }
  return '0.0.0'
}

const USAGE = `flow-visualizer ${version()}

  flow-visualizer scan <path...> [options]   draft documents from a codebase
      --title <name>        name for the generated documents
      --split / --no-split  one document per feature (default: above 150 nodes)
      --min-nodes <n>       pool features smaller than this (default 3)
      --out <path>          where to write (default docs/apps/<name>)

  flow-visualizer parse [path...] [options]  index documents into graphs
      --out <dir>           graph output (default public/graphs)
      --manifest <file>     index output (default public/documents.json)
      --strict              fail on warnings as well as errors

  flow-visualizer serve [options]            open the viewer
      --port <n>            default 4173
      --host <h>            default 127.0.0.1
      --root <dir>          project to read docs/ from (default cwd)
      --open                open a browser

Documents are Markdown. See the format guide shipped with this package.`

interface Flags {
  positional: string[]
  values: Map<string, string>
  booleans: Set<string>
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { positional: [], values: new Map(), booleans: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      flags.positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.values.set(name, next)
      i++
    } else {
      flags.booleans.add(name)
    }
  }
  return flags
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const flags = parseFlags(rest)

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.error(USAGE)
    process.exit(command ? 0 : 2)
  }

  if (command === 'version' || command === '--version') {
    console.log(version())
    return
  }

  // ------------------------------------------------------------------ scan
  if (command === 'scan') {
    if (flags.positional.length === 0) {
      console.error('scan needs at least one project path.\n\n' + USAGE)
      process.exit(2)
    }
    const result = runScan({
      roots: flags.positional,
      title: flags.values.get('title'),
      split: flags.booleans.has('split') ? true : flags.booleans.has('no-split') ? false : undefined,
      minNodes: Number(flags.values.get('min-nodes')) || undefined,
      out: flags.values.get('out'),
    })
    console.error(
      [
        `scanned ${result.report.filesScanned} files`,
        `${result.draft.stats.endpoints} endpoints, ${result.draft.stats.entities} entities`,
        result.splitApplied
          ? `split into ${result.written.length} documents by feature`
          : 'wrote one document',
        ...result.written.map((w) => `  ${w.path}  (${w.nodes} nodes, ${w.warnings} warn)`),
        '',
        'Workflows are never generated — trace them by hand, then run `flow-visualizer parse`.',
      ].join('\n'),
    )
    process.exit(result.written.some((w) => w.errors > 0) ? 1 : 0)
  }

  // ------------------------------------------------------------------ parse
  if (command === 'parse') {
    const result = buildDocuments({
      paths: flags.positional.length > 0 ? flags.positional : ['docs'],
      outDir: flags.values.get('out') ?? 'public/graphs',
      manifest: flags.values.get('manifest') ?? 'public/documents.json',
    })
    for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic))
    if (result.entries.length === 0) {
      console.error('No functionality documents found. A document must declare a `### Node:`.')
      process.exit(2)
    }
    for (const entry of result.entries) {
      console.error(
        `${entry.source.padEnd(40)} ${String(entry.nodes).padStart(4)} nodes  ` +
          `${String(entry.workflows).padStart(2)} wf  ${entry.errors} err  ${entry.warnings} warn`,
      )
    }
    console.error(`\n${result.entries.length} document(s), ${result.errors} error(s)`)
    const failed = result.errors > 0 || (flags.booleans.has('strict') && result.warnings > 0)
    process.exit(failed ? 1 : 0)
  }

  // ------------------------------------------------------------------ serve
  if (command === 'serve') {
    const webRoot = findWebRoot()
    if (!existsSync(resolve(webRoot, 'index.html'))) {
      console.error(
        `The viewer bundle is missing (looked in ${webRoot}).\n` +
          'If you are running from a source checkout, build it first: npm run build',
      )
      process.exit(2)
    }

    const { port } = await serve({
      root: resolve(flags.values.get('root') ?? process.cwd()),
      webRoot,
      outRoot: flags.values.get('out-root') ?? 'public',
      port: Number(flags.values.get('port')) || 4173,
      host: flags.values.get('host') ?? '127.0.0.1',
    })

    const url = `http://localhost:${port}`
    console.error(`\nflow-visualizer serving ${url}\n`)
    if (flags.booleans.has('open')) {
      const { spawn } = await import('node:child_process')
      const opener =
        process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      spawn(opener, [url], { shell: true, stdio: 'ignore', detached: true }).unref()
    }
    return
  }

  console.error(`Unknown command: ${command}\n\n${USAGE}`)
  process.exit(2)
}

void main()
