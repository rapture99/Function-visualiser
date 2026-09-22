/**
 * Preparing the authoring prompt for the clipboard.
 *
 * The prompt text is imported from `docs/AUTHORING-PROMPT.md` at build time rather than
 * duplicated here, so there is exactly one copy of it and the button can never drift from
 * the file. These functions are pure and DOM-free so they can be tested directly.
 */

export interface PromptFields {
  target: string
  scope: 'system' | 'feature' | 'function'
  output: string
  depth: string
}

export const SCOPES: ReadonlyArray<{ value: PromptFields['scope']; label: string }> = [
  { value: 'system', label: 'system — a whole application' },
  { value: 'feature', label: 'feature — one feature and what it touches' },
  { value: 'function', label: 'function — one function or component' },
]

export const DEPTHS: readonly string[] = [
  'start with the 2 most important workflows',
  'cover every workflow',
]

/**
 * Pull the prompt body out of its fenced block.
 *
 * AUTHORING-PROMPT.md wraps the prompt in a four-backtick fence precisely because the prompt
 * itself contains three-backtick examples, so the opening fence is matched by length and the
 * closing one has to match it.
 */
export function extractPrompt(markdown: string): string {
  const fenced = /^(`{4,})[^\n]*\n([\s\S]*?)\n\1[ \t]*$/m.exec(markdown)
  return (fenced?.[2] ?? markdown).trim()
}

/** Replace one `KEY = ...` line inside the FILL THESE IN block. */
function setField(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^([ \\t]*${key}[ \\t]*=[ \\t]*).*$`, 'm')
  return pattern.test(text) ? text.replace(pattern, `$1${value}`) : text
}

export function fillPrompt(promptBody: string, fields: PromptFields): string {
  let out = promptBody
  out = setField(out, 'TARGET', fields.target.trim() || 'the whole app')
  out = setField(out, 'SCOPE', fields.scope)
  out = setField(out, 'OUTPUT', fields.output.trim())
  out = setField(out, 'DEPTH', fields.depth.trim())
  return out
}

/** Where this project lives on disk, injected at build time. */
export function projectRoot(): string {
  const injected = (globalThis as { __PROJECT_ROOT__?: string }).__PROJECT_ROOT__
  return injected ?? '.'
}

export function defaultOutputPath(name = 'my-app'): string {
  const root = projectRoot()
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root}${separator}docs${separator}${name}.md`
}

export function defaultFields(): PromptFields {
  return {
    target: 'the whole app',
    scope: 'system',
    output: defaultOutputPath(),
    depth: DEPTHS[0]!,
  }
}

/**
 * Copy text, falling back to a selection when the async clipboard is unavailable — it needs
 * a secure context, which a plain-http LAN address is not.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
