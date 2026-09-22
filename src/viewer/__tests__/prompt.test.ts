import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEPTHS, defaultFields, extractPrompt, fillPrompt } from '../prompt.js'

const authoring = readFileSync(
  fileURLToPath(new URL('../../../docs/AUTHORING-PROMPT.md', import.meta.url)),
  'utf8',
)
const body = extractPrompt(authoring)

describe('extractPrompt', () => {
  it('takes the prompt out of its outer fence and leaves the surrounding page behind', () => {
    expect(body).toMatch(/^Generate a functionality document/)
    expect(body).not.toContain('Paste the block below')
  })

  it('keeps the three-backtick examples that live inside the prompt', () => {
    // The outer fence is four backticks precisely so these survive; if the extractor stopped
    // at the first ``` the prompt would be truncated at its first example.
    expect(body).toContain('```md')
    expect(body).toContain('### Node: apply-leave-page')
    expect(body).toContain('## Deliver')
  })

  it('falls back to the whole text when there is no fence', () => {
    expect(extractPrompt('just some text')).toBe('just some text')
  })
})

describe('fillPrompt', () => {
  const filled = fillPrompt(body, {
    target: 'the billing feature',
    scope: 'feature',
    output: 'C:\\proj\\docs\\billing.md',
    depth: DEPTHS[1]!,
  })

  it('substitutes every placeholder', () => {
    expect(filled).toContain('TARGET   = the billing feature')
    expect(filled).toContain('SCOPE    = feature')
    expect(filled).toContain('OUTPUT   = C:\\proj\\docs\\billing.md')
    expect(filled).toContain(`DEPTH    = ${DEPTHS[1]}`)
  })

  it('leaves no bracketed placeholder behind', () => {
    // A prompt pasted with `[system | feature | function]` still in it documents the wrong
    // thing, silently.
    const fillBlock = filled.slice(filled.indexOf('FILL THESE IN'), filled.indexOf('## Your task'))
    expect(fillBlock).not.toMatch(/=\s*\[/)
  })

  it('changes nothing else about the prompt', () => {
    expect(filled.split('\n')).toHaveLength(body.split('\n').length)
    expect(filled).toContain('## Five non-negotiable rules')
    expect(filled).toContain('Never invent a connection')
  })

  it('is stable under repeated filling', () => {
    const again = fillPrompt(filled, {
      target: 'the billing feature',
      scope: 'feature',
      output: 'C:\\proj\\docs\\billing.md',
      depth: DEPTHS[1]!,
    })
    expect(again).toBe(filled)
  })
})

describe('defaults', () => {
  it('offers a sensible starting point', () => {
    const fields = defaultFields()
    expect(fields.scope).toBe('system')
    expect(fields.output).toMatch(/docs[\\/].+\.md$/)
    expect(DEPTHS).toContain(fields.depth)
  })
})
