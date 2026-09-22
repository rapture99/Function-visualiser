/**
 * Stage 1: Markdown -> flat, line-numbered blocks.
 *
 * Hand-written line scanner rather than remark/mdast. The convention is strictly
 * line-oriented (headings, `Key: Value`, list items), so a scanner is both simpler and
 * gives exact line numbers for free — and precise `file:line` diagnostics are the whole
 * reason this stage exists. Fenced code blocks and HTML comments are skipped so that
 * example snippets inside the document are never mistaken for declarations.
 */

export type Block =
  | { type: 'heading'; depth: number; kind: string | null; value: string; line: number }
  | { type: 'kv'; key: string; value: string; line: number }
  | { type: 'ordered'; value: string; line: number }
  | { type: 'bullet'; value: string; line: number }
  | { type: 'text'; value: string; line: number }

const RE_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const RE_ORDERED = /^\s*\d+[.)]\s+(.*)$/
const RE_BULLET = /^\s*[-*+]\s+(.*)$/
const RE_KV = /^([A-Za-z][A-Za-z0-9 _/-]*?)\s*:[ \t]*(.*)$/
const RE_FENCE = /^\s*(`{3,}|~{3,})/
const RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

const MAX_KEY_WORDS = 3
const MAX_KEY_CHARS = 32

/**
 * Ordinary prose containing a colon ("At function scope: inputs are the interface layer")
 * would otherwise be captured as metadata. Real keys are short — `Name`, `Component`,
 * `Error paths` — so a length guard separates the two without needing a fixed key list,
 * which would defeat the point of letting authors invent their own metadata.
 */
function isPlausibleKey(key: string): boolean {
  const trimmed = key.trim()
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_KEY_CHARS &&
    trimmed.split(/\s+/).length <= MAX_KEY_WORDS
  )
}

/** Strip surrounding `code ticks`, **bold**, _italics_ and trailing punctuation noise. */
export function clean(value: string): string {
  return value
    .replace(/^`+|`+$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^_+|_+$/g, '')
    .trim()
}

export function scan(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.split(/\r?\n/)
  /** The open fence's character and length, or null outside a fence. */
  let fence: { char: string; length: number } | null = null
  let inComment = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ''
    const line = i + 1
    const trimmed = raw.trim()

    // A fence is closed only by one of the same character and at least the same length
    // (CommonMark). Treating every ``` as a toggle breaks the moment a document quotes a
    // fenced example inside a longer fence — which is exactly what documentation about this
    // format does, so the format's own guide would parse as a functionality document.
    const marker = RE_FENCE.exec(raw)?.[1]
    if (marker) {
      if (!fence) {
        fence = { char: marker[0]!, length: marker.length }
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fence) continue

    if (inComment) {
      if (trimmed.includes('-->')) inComment = false
      continue
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true
      continue
    }

    if (!trimmed) continue
    if (RE_HR.test(trimmed)) continue

    // Order matters: headings first, then list items, then key/value. A bullet such as
    // `- at post-leaves: reason` must not be swallowed by the key/value rule.
    const heading = RE_HEADING.exec(trimmed)
    if (heading) {
      const depth = heading[1]!.length
      const text = heading[2]!.trim()
      const colon = text.indexOf(':')
      if (colon > 0) {
        blocks.push({
          type: 'heading',
          depth,
          kind: text.slice(0, colon).trim().toLowerCase(),
          value: clean(text.slice(colon + 1)),
          line,
        })
      } else {
        blocks.push({ type: 'heading', depth, kind: null, value: clean(text), line })
      }
      continue
    }

    const ordered = RE_ORDERED.exec(raw)
    if (ordered) {
      blocks.push({ type: 'ordered', value: ordered[1]!.trim(), line })
      continue
    }

    const bullet = RE_BULLET.exec(raw)
    if (bullet) {
      blocks.push({ type: 'bullet', value: bullet[1]!.trim(), line })
      continue
    }

    const kv = RE_KV.exec(trimmed)
    if (kv && isPlausibleKey(kv[1]!)) {
      blocks.push({ type: 'kv', key: kv[1]!.trim(), value: kv[2]!.trim(), line })
      continue
    }

    blocks.push({ type: 'text', value: trimmed, line })
  }

  return blocks
}
