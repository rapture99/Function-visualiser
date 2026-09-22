import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { discover, looksLikeFunctionalityDoc } from '../discover.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const docs = fileURLToPath(new URL('../../../docs', import.meta.url))
const fixtures = fileURLToPath(new URL('../../testing/fixtures', import.meta.url))

describe('looksLikeFunctionalityDoc', () => {
  it('accepts a document that declares nodes or workflows', () => {
    expect(looksLikeFunctionalityDoc('### Node: a\nType: Service\n')).toBe(true)
    expect(looksLikeFunctionalityDoc('## Workflow: w\nSteps:\n1. a\n')).toBe(true)
  })

  it('rejects prose', () => {
    expect(looksLikeFunctionalityDoc('# Readme\n\nSome text about nodes and workflows.\n')).toBe(false)
  })

  it('rejects a guide whose only declarations are inside code fences', () => {
    // This is the case that matters: the format's own documentation is full of examples.
    expect(looksLikeFunctionalityDoc('```md\n### Node: a\nType: Service\n```\n')).toBe(false)
    expect(
      looksLikeFunctionalityDoc('````text\n```md\n### Node: a\nType: Service\n```\n````\n'),
    ).toBe(false)
  })
})

describe('discover', () => {
  const found = discover([fixtures], root)

  it('finds every document in a folder', () => {
    expect(found.map((d) => d.relative).sort()).toEqual([
      'src/testing/fixtures/hrms-leave.md',
      'src/testing/fixtures/sample-feature.md',
      'src/testing/fixtures/sample-function.md',
      'src/testing/fixtures/sample-system.md',
    ])
  })

  it('never picks up prose about the format itself', () => {
    // CONVENTION.md and AUTHORING-PROMPT.md are *about* the format and are full of
    // `### Node:` examples — but inside code fences, so neither is a document. Asserted by
    // exclusion rather than by docs/ being empty, since real documents live there too.
    const relatives = discover([docs], root).map((d) => d.relative)
    expect(relatives).not.toContain('docs/CONVENTION.md')
    expect(relatives).not.toContain('docs/AUTHORING-PROMPT.md')
  })

  it('keys documents by basename, not by path', () => {
    expect(found.map((d) => d.key).sort()).toEqual([
      'hrms-leave',
      'sample-feature',
      'sample-function',
      'sample-system',
    ])
  })

  it('takes an explicitly named file as-is, without filtering it', () => {
    const guide = fileURLToPath(new URL('../../../docs/CONVENTION.md', import.meta.url))
    // Naming a file is an instruction; second-guessing it would be surprising.
    expect(discover([guide], root).map((d) => d.relative)).toEqual(['docs/CONVENTION.md'])
  })

  it('is deterministic and de-duplicated', () => {
    expect(discover([fixtures, fixtures], root)).toEqual(found)
  })

  it('throws on a path that does not exist', () => {
    expect(() => discover(['./definitely-not-here'], root)).toThrow(/Cannot read/)
  })
})
