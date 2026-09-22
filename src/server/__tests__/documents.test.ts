import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildDocuments } from '../../parser/buildDocuments.js'
import { runScan, SPLIT_THRESHOLD } from '../../scanner/runScan.js'

const scratch = mkdtempSync(join(tmpdir(), 'funcviz-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const fixtures = fileURLToPath(new URL('../../scanner/__tests__/fixtures', import.meta.url))
const documents = fileURLToPath(new URL('../../testing/fixtures', import.meta.url))

/**
 * These are the functions the CLI and the dev-server API both call. Testing them here rather
 * than through either entry point is the point: the button in the UI and the command line
 * cannot drift apart if there is only one implementation and it is covered.
 */
describe('buildDocuments', () => {
  const outDir = join(scratch, 'graphs')
  const manifest = join(scratch, 'documents.json')
  const result = buildDocuments({ paths: [documents], outDir, manifest })

  it('writes one graph per document plus an index', () => {
    expect(result.entries.length).toBeGreaterThanOrEqual(4)
    expect(readdirSync(outDir).filter((f) => f.endsWith('.json')).length).toBe(result.entries.length)
    const index = JSON.parse(readFileSync(manifest, 'utf8')) as { documents: unknown[] }
    expect(index.documents).toHaveLength(result.entries.length)
  })

  it('records counts and provenance for each entry', () => {
    for (const entry of result.entries) {
      expect(entry.source).toMatch(/\.md$/)
      expect(entry.url).toMatch(/^graphs\/.+\.json$/)
      expect(entry.nodes).toBeGreaterThan(0)
    }
  })

  it('reports an empty result rather than throwing when nothing is found', () => {
    const emptyDir = join(scratch, 'empty')
    mkdirSync(emptyDir, { recursive: true })
    writeFileSync(join(emptyDir, 'notes.md'), '# Just prose\n\nNothing declared here.\n')
    const empty = buildDocuments({
      paths: [emptyDir],
      outDir: join(scratch, 'graphs-empty'),
      manifest: join(scratch, 'empty.json'),
    })
    expect(empty.entries).toEqual([])
  })
})

describe('runScan', () => {
  it('writes a single document for a small project', () => {
    const out = join(scratch, 'small.md')
    const result = runScan({ roots: [fixtures], title: 'Small', out })
    expect(result.splitApplied).toBe(false)
    expect(result.written).toHaveLength(1)
    expect(readFileSync(out, 'utf8')).toContain('This is a draft')
  })

  it('honours an explicit split even below the threshold', () => {
    const out = join(scratch, 'forced-split')
    const result = runScan({ roots: [fixtures], title: 'Forced', split: true, minNodes: 1, out })
    expect(result.splitApplied).toBe(true)
    expect(result.written.length).toBeGreaterThan(1)
    for (const written of result.written) {
      expect(written.errors, `${written.feature} has parse errors`).toBe(0)
    }
  })

  it('decides to split from the node count when not told', () => {
    // The threshold is the whole point: a catalogue past this size never gets finished,
    // so "no opinion" has to mean "split" rather than "one giant file".
    const result = runScan({ roots: [fixtures], title: 'Auto', out: join(scratch, 'auto.md') })
    expect(result.draft.nodes.length).toBeLessThan(SPLIT_THRESHOLD)
    expect(result.splitApplied).toBe(false)
  })

  it('refuses a directory with no source in it', () => {
    const barren = join(scratch, 'barren')
    mkdirSync(barren, { recursive: true })
    expect(() => runScan({ roots: [barren], title: 'Barren' })).toThrow(/No scannable source/)
  })

  it('produces documents the parser accepts', () => {
    const out = join(scratch, 'valid')
    const result = runScan({ roots: [fixtures], title: 'Valid', split: true, minNodes: 1, out })
    for (const written of result.written) {
      expect(written.errors).toBe(0)
      expect(written.nodes).toBeGreaterThan(0)
    }
  })
})
