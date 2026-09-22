import { useCallback, useEffect, useRef, useState } from 'react'
import { parse } from '../../parser/index.js'
import type { DocumentSource } from '../graph/useGraph.js'

/**
 * Drop a `.md` file — or a whole folder — onto the page and it is parsed here, in the
 * browser, with no build step and no server round trip.
 *
 * This works because the parser has no Node dependencies: `scan → extract → resolve` is pure
 * TypeScript, and only the CLI ever touches `node:fs`. So the exact same code that produces
 * the checked-in graphs runs against a file you dragged in a second ago, which means what you
 * see is what `npm run parse` would have produced.
 */

const MARKDOWN = /\.mdx?$/i

async function filesFromEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    )
    if (MARKDOWN.test(file.name)) out.push(file)
    return
  }
  if (!entry.isDirectory) return

  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries yields at most 100 at a time and must be pumped until it returns nothing.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) break
    for (const child of batch) await filesFromEntry(child, out)
  }
}

async function filesFromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  const entries = [...transfer.items]
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry))

  if (entries.length > 0) {
    const files: File[] = []
    for (const entry of entries) await filesFromEntry(entry, files)
    return files
  }

  // Browsers without the entries API still give a flat file list.
  return [...transfer.files].filter((file) => MARKDOWN.test(file.name))
}

async function toDocuments(files: File[]): Promise<DocumentSource[]> {
  const documents: DocumentSource[] = []
  for (const file of files) {
    const text = await file.text()
    const name = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const result = parse(text, name)
    documents.push({
      key: `dropped:${name}`,
      label: result.graph.meta.title ?? file.name.replace(MARKDOWN, ''),
      scope: result.graph.meta.scope,
      source: name,
      graph: result.graph,
      origin: 'dropped',
      stats: {
        nodes: result.graph.nodes.length,
        edges: result.graph.edges.length,
        workflows: result.graph.workflows.length,
        errors: result.errorCount,
        warnings: result.warningCount,
      },
    })
  }
  // A folder full of prose would otherwise add a pile of empty documents.
  return documents.filter((document) => (document.stats?.nodes ?? 0) > 0)
}

export interface DocumentDropProps {
  onAdd: (documents: DocumentSource[]) => void
  onSelect: (key: string) => void
}

export function DocumentDrop({ onAdd, onSelect }: DocumentDropProps) {
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const depth = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        setMessage('No Markdown files in there.')
        return
      }
      setBusy(true)
      try {
        const documents = await toDocuments(files)
        if (documents.length === 0) {
          setMessage(`Read ${files.length} file(s), but none declared any nodes.`)
          return
        }
        onAdd(documents)
        onSelect(documents[0]!.key)
        setMessage(`Loaded ${documents.length} document(s).`)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    },
    [onAdd, onSelect],
  )

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth.current += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      void filesFromDataTransfer(event.dataTransfer).then(ingest)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [ingest])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [message])

  return (
    <>
      <button type="button" className="pill" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Parsing…' : 'Open .md'}
      </button>
      <input
        ref={input}
        type="file"
        accept=".md,.mdx"
        multiple
        hidden
        onChange={(event) => {
          void ingest([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      {message ? <span className="drop-message">{message}</span> : null}
      {dragging ? (
        <div className="drop-overlay">
          <div>
            <strong>Drop Markdown here</strong>
            <p>A file or a whole folder. Parsed in the browser — nothing is uploaded.</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
