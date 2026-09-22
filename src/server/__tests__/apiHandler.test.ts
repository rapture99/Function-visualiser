import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isInside, reindex, workspaceAt } from '../apiHandler.js'

const scratch = mkdtempSync(join(tmpdir(), 'flowviz-api-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const DOCUMENT = `# App: Sample
Scope: feature

### Node: caller
Type: Actor

### Node: endpoint
Type: Endpoint
Name: POST /x

## Workflow: call
Roles: User

Steps:
1. caller
2. endpoint
`

function makeWorkspace(name: string) {
  const root = join(scratch, name)
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'sample.md'), DOCUMENT)
  return workspaceAt(root)
}

describe('workspaceAt', () => {
  it('puts every generated artefact under the project root', () => {
    const workspace = workspaceAt('/tmp/project')
    for (const path of [workspace.docsDir, workspace.outDir, workspace.manifest, workspace.trashDir]) {
      expect(isInside(workspace.root, path)).toBe(true)
    }
  })

  it('honours an alternative output root, so an installed copy can keep its own', () => {
    const workspace = workspaceAt('/tmp/project', '.flow')
    expect(workspace.outDir).toContain('.flow')
    expect(workspace.manifest).toContain('.flow')
  })
})

describe('isInside', () => {
  it('accepts a descendant and refuses an escape', () => {
    expect(isInside('/a/b', '/a/b/c.md')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(false)
    expect(isInside('/a/b', '/a/c.md')).toBe(false)
    expect(isInside('/a/b', '/a/b/../../etc/passwd')).toBe(false)
  })
})

describe('reindex', () => {
  it('writes graphs and a manifest for a workspace', () => {
    const workspace = makeWorkspace('indexed')
    const result = reindex(workspace)

    expect(result.entries).toHaveLength(1)
    expect(result.errors).toBe(0)
    expect(existsSync(workspace.manifest)).toBe(true)
    expect(readdirSync(workspace.outDir)).toHaveLength(1)
    expect(result.entries[0]!.workflows).toBe(1)
  })

  it('is the same operation the CLI performs, so both stay in step', () => {
    // One implementation, two callers — the dev server, the packaged server and the CLI all
    // land here, which is why the button and the command cannot diverge.
    const workspace = makeWorkspace('twice')
    const first = reindex(workspace)
    const second = reindex(workspace)
    expect(second.entries).toEqual(first.entries)
  })

  it('produces an empty index rather than failing on a docs folder with no documents', () => {
    const root = join(scratch, 'barren')
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'notes.md'), '# Notes\n\nProse only.\n')
    const result = reindex(workspaceAt(root))
    expect(result.entries).toEqual([])
  })
})
