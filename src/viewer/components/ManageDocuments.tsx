import { useEffect, useRef, useState } from 'react'
import * as api from '../api.js'
import type { DocumentSource } from '../graph/useGraph.js'

/**
 * Adding and removing documents without going back to a terminal.
 *
 * Backed by the dev-server API, so it is only offered while `npm run dev` is running. On a
 * built site the panel says so instead of showing controls that would fail.
 *
 * Splitting defaults to "decide for me", which splits above 150 nodes. That threshold is not
 * cosmetic: a single catalogue that size never gets pruned or given workflows, because nobody
 * can hold it in their head long enough to finish it.
 */

const SPLIT_HINT = 150

type Busy = null | 'scanning' | 'reindexing' | 'removing'

export interface ManageDocumentsProps {
  documents: DocumentSource[]
  activeKey: string | null
  onDocuments: (documents: DocumentSource[]) => void
  onSelect: (key: string) => void
}

export function ManageDocuments({ documents, activeKey, onDocuments, onSelect }: ManageDocumentsProps) {
  const [open, setOpen] = useState(false)
  const [paths, setPaths] = useState('')
  const [title, setTitle] = useState('')
  const [splitMode, setSplitMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onClick = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const timer = setTimeout(() => window.addEventListener('mousedown', onClick), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
      clearTimeout(timer)
    }
  }, [open])

  const run = async <T,>(state: Busy, work: () => Promise<T>, describe: (result: T) => string) => {
    setBusy(state)
    setError(null)
    setMessage(null)
    try {
      const result = await work()
      setMessage(describe(result))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  const onScan = () =>
    run(
      'scanning',
      () =>
        api.scan({
          paths: paths
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          title: title.trim() || undefined,
          ...(splitMode === 'auto' ? {} : { split: splitMode === 'on' }),
        }),
      (result) => {
        onDocuments(api.toDocuments(result.documents))
        const first = result.written[0]
        if (first) onSelect(result.documents.find((d) => d.source.endsWith(first.path.split('/').pop() ?? ''))?.key ?? result.documents[0]!.key)
        return (
          `Scanned ${result.filesScanned} files, found ${result.nodesFound} nodes. ` +
          (result.splitApplied
            ? `Split into ${result.written.length} documents by feature.`
            : 'Wrote one document.')
        )
      },
    )

  const onReindex = () =>
    run('reindexing', api.reindex, (result) => {
      onDocuments(api.toDocuments(result.documents))
      return `Reindexed ${result.documents.length} document(s), ${result.warnings} warning(s).`
    })

  const onRemove = (document: DocumentSource) => {
    setConfirming(null)
    if (!document.source) return
    void run('removing', () => api.remove(document.source!), (result) => {
      onDocuments(api.toDocuments(result.documents))
      return `Moved to ${result.movedTo} — recoverable from there.`
    })
  }

  return (
    <div className="prompt-anchor">
      <button type="button" className="pill" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Documents
      </button>

      {open ? (
        <div className="prompt-dialog manage" ref={panel} role="dialog" aria-label="Manage documents">
          {!api.available ? (
            <p className="prompt-lead">
              Adding and removing documents needs the dev server. Run <code>npm run dev</code>.
            </p>
          ) : (
            <>
              <h3 className="manage-heading">Add from a codebase</h3>
              <p className="prompt-lead">
                Scans a project and writes draft documents into <code>docs/</code>. One path per
                line — pass a frontend and its API together and their calls resolve into real
                connections.
              </p>

              <label className="prompt-field">
                <span>Project path(s)</span>
                <textarea
                  rows={2}
                  value={paths}
                  onChange={(event) => setPaths(event.target.value)}
                  placeholder={'c:\\path\\to\\my-frontend\nc:\\path\\to\\my-api'}
                />
              </label>

              <div className="manage-row">
                <label className="prompt-field" style={{ flex: 1 }}>
                  <span>Title (optional)</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="folder name"
                  />
                </label>
                <label className="prompt-field" style={{ width: 150 }}>
                  <span>Split by feature</span>
                  <select
                    value={splitMode}
                    onChange={(event) => setSplitMode(event.target.value as typeof splitMode)}
                  >
                    <option value="auto">Auto (&gt;{SPLIT_HINT} nodes)</option>
                    <option value="on">Always</option>
                    <option value="off">Never</option>
                  </select>
                </label>
              </div>

              <div className="prompt-actions">
                <button
                  type="button"
                  className="pill primary"
                  disabled={busy !== null || paths.trim() === ''}
                  onClick={onScan}
                >
                  {busy === 'scanning' ? 'Scanning…' : 'Scan and add'}
                </button>
                <button type="button" className="pill" disabled={busy !== null} onClick={onReindex}>
                  {busy === 'reindexing' ? 'Reindexing…' : 'Reindex docs/'}
                </button>
              </div>

              {error ? <p className="manage-error">{error}</p> : null}
              {message ? <p className="manage-ok">{message}</p> : null}

              <h3 className="manage-heading">Documents ({documents.length})</h3>
              <div className="manage-list">
                {documents.length === 0 ? (
                  <p className="empty">Nothing indexed yet.</p>
                ) : (
                  documents.map((document) => (
                    <div
                      key={document.key}
                      className={`manage-item${document.key === activeKey ? ' current' : ''}`}
                    >
                      <button type="button" className="manage-open" onClick={() => onSelect(document.key)}>
                        {document.label}
                        <span className="sub">
                          {document.stats
                            ? `${document.stats.nodes} nodes · ${document.stats.workflows} workflows` +
                              (document.stats.warnings ? ` · ${document.stats.warnings} warnings` : '')
                            : document.origin === 'dropped'
                              ? 'dropped, not on disk'
                              : ''}
                          {document.stats && document.stats.nodes > SPLIT_HINT
                            ? ' · large, consider splitting'
                            : ''}
                        </span>
                      </button>

                      {document.origin === 'manifest' && document.source ? (
                        confirming === document.key ? (
                          <span className="manage-confirm">
                            <button type="button" className="pill danger" onClick={() => onRemove(document)}>
                              Remove
                            </button>
                            <button type="button" className="pill" onClick={() => setConfirming(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="pill"
                            disabled={busy !== null}
                            onClick={() => setConfirming(document.key)}
                            title={`Move ${document.source} to docs/.trash/`}
                          >
                            Remove
                          </button>
                        )
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              <p className="prompt-note">
                Removing moves the Markdown to <code>docs/.trash/</code> rather than deleting it.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
