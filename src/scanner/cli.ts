#!/usr/bin/env node
/**
 * Scan any project and emit a draft functionality document.
 *
 *   tsx src/scanner/cli.ts <project-path> [-o <file.md>] [--title "Name"]
 *
 * The output is a starting point, not an answer: a node catalogue with a file:line for every
 * entry, plus the dependency edges that could be established from real HTTP calls. Workflows
 * are left blank on purpose.
 */

import { relative, resolve } from 'node:path'
import { runScan } from './runScan.js'

interface Options {
  roots: string[]
  out?: string
  title?: string
  /** Emit one document per feature instead of a single catalogue. */
  split: boolean
  /** Whether --split was passed at all, as opposed to defaulted. */
  explicitSplit: boolean
  /** Features smaller than this are pooled into one "Other" document. */
  minNodes: number
}

function parseArgs(argv: string[]): Options | null {
  const options: Options = { roots: [], split: false, explicitSplit: false, minNodes: 3 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '-o' || arg === '--out') options.out = argv[++i]
    else if (arg === '--title') options.title = argv[++i]
    else if (arg === '--split') { options.split = true; options.explicitSplit = true }
    else if (arg === '--no-split') { options.split = false; options.explicitSplit = true }
    else if (arg === '--min-nodes') options.minNodes = Number(argv[++i]) || 3
    else if (arg === '-h' || arg === '--help') return null
    else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`)
      return null
    } else options.roots.push(arg)
  }
  return options.roots.length > 0 ? options : null
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    console.error(
      [
        'Usage: scan <project-path...> [-o <file.md>] [--title "Name"] [--split]',
        '',
        'Emits a draft functionality document: a node catalogue with provenance.',
        '--split writes one document per feature into a directory, which is the only way a',
        'large project becomes reviewable. --min-nodes N pools smaller features (default 3).',
        'Pass several paths to scan a frontend and its API together, so calls resolve to routes.',
        'Workflows are never generated — they describe intent, which a scanner cannot see.',
      ].join('\n'),
    )
    process.exit(2)
  }

  let result
  try {
    result = runScan({
      roots: options.roots,
      title: options.title,
      split: options.explicitSplit ? options.split : undefined,
      minNodes: options.minNodes,
      out: options.out,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }

  const { report, draft, written } = result
  const title = result.title

  const topLanguages = Object.entries(report.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([extension, count]) => `${extension}:${count}`)
    .join(' ')

  console.error(
    [
      '',
      `scanned    ${report.filesScanned} files (${report.filesSkipped} skipped)`,
      `languages  ${topLanguages}`,
      `endpoints  ${draft.stats.endpoints}`,
      `entities   ${draft.stats.entities}`,
      `structural ${draft.stats.fromConventions} nodes from directory conventions`,
      `calls      ${draft.stats.linkedCalls} linked to a route, ${draft.stats.unlinkedCalls} unmatched, ` +
        `${draft.stats.computedCalls} with a computed URL`,
      '',
      ...written.map(
        (w) =>
          `wrote      ${relative(resolve('.'), w.path)}  (${w.nodes} nodes, ${w.errors} err, ${w.warnings} warn)`,
      ),
      '',
      'Next: open the file, delete the noise, fix any wrong Type: lines, and write the',
      'workflows by tracing the code. The orphan-node warnings are the to-do list.',
      '',
    ].join('\n'),
  )

  process.exit(written.some((w) => w.errors > 0) ? 1 : 0)
}


main()
