import { useEffect, useMemo, useRef, useState } from 'react'
// Imported raw at build time so the button and the file can never disagree.
import authoringPrompt from '../../../docs/AUTHORING-PROMPT.md?raw'
import {
  DEPTHS,
  SCOPES,
  copyText,
  defaultFields,
  extractPrompt,
  fillPrompt,
  type PromptFields,
} from '../prompt.js'

const PROMPT_BODY = extractPrompt(authoringPrompt)

/**
 * Copies the authoring prompt, with its four placeholders already filled in.
 *
 * The point is to close the loop: this tool renders documents but cannot write them, and
 * writing one means reading a codebase — which is a job for an agent sitting in that
 * codebase, not for a viewer. So the button hands you the exact instructions to paste
 * wherever the code is, and the result comes back as a file you drop on this page.
 *
 * Filling the fields in here rather than shipping placeholders matters: a prompt pasted with
 * `[the whole app | the <X> feature]` still in it produces a document about the wrong thing.
 */
export function PromptDialog() {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState<PromptFields>(defaultFields)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstField = useRef<HTMLInputElement>(null)

  const text = useMemo(() => fillPrompt(PROMPT_BODY, fields), [fields])

  useEffect(() => {
    if (!open) return
    firstField.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onClick = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // Deferred so the click that opened the dialog does not immediately close it.
    const timer = setTimeout(() => window.addEventListener('mousedown', onClick), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
      clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => setCopied('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const update = <K extends keyof PromptFields>(key: K, value: PromptFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }))

  return (
    <div className="prompt-anchor">
      <button
        type="button"
        className="pill"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Copy the prompt that generates a document from a codebase"
      >
        Copy prompt
      </button>

      {open ? (
        <div className="prompt-dialog" ref={dialogRef} role="dialog" aria-label="Copy authoring prompt">
          <p className="prompt-lead">
            Paste this into Claude Code <strong>inside the repository you want documented</strong>.
            It writes a <code>.md</code> file you can drop onto this page.
          </p>

          <label className="prompt-field">
            <span>What to document</span>
            <input
              ref={firstField}
              type="text"
              value={fields.target}
              onChange={(event) => update('target', event.target.value)}
              placeholder="the whole app / the billing feature / calculateTotal()"
            />
          </label>

          <label className="prompt-field">
            <span>Scope</span>
            <select
              value={fields.scope}
              onChange={(event) => update('scope', event.target.value as PromptFields['scope'])}
            >
              {SCOPES.map((scope) => (
                <option key={scope.value} value={scope.value}>
                  {scope.label}
                </option>
              ))}
            </select>
          </label>

          <label className="prompt-field">
            <span>Write the file to</span>
            <input
              type="text"
              value={fields.output}
              onChange={(event) => update('output', event.target.value)}
            />
          </label>

          <label className="prompt-field">
            <span>How far to go</span>
            <select value={fields.depth} onChange={(event) => update('depth', event.target.value)}>
              {DEPTHS.map((depth) => (
                <option key={depth} value={depth}>
                  {depth}
                </option>
              ))}
            </select>
          </label>

          <details className="prompt-preview">
            <summary>Preview ({text.split('\n').length} lines)</summary>
            <pre>{text}</pre>
          </details>

          <div className="prompt-actions">
            <button
              type="button"
              className="pill primary"
              onClick={async () => setCopied((await copyText(text)) ? 'ok' : 'failed')}
            >
              {copied === 'ok' ? 'Copied ✓' : copied === 'failed' ? 'Copy failed' : 'Copy to clipboard'}
            </button>
            {copied === 'failed' ? (
              <span className="prompt-note">
                Clipboard blocked — open the preview and copy it by hand.
              </span>
            ) : (
              <span className="prompt-note">
                Then: <code>npm run parse</code>, or drop the file here.
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
