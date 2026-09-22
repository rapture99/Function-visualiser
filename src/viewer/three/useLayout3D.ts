import { useEffect, useRef, useState } from 'react'
import type { Graph } from '../../schema/graph.js'
import { computeLayout } from '../../layout/index.js'
import type { LayoutResult } from '../../layout/types.js'
// The emitted worker's URL, so it can be started directly or copied into a blob.
import workerUrl from '../../layout/worker.ts?worker&url'

/**
 * Runs the layout off the main thread when the environment allows it, and never lets the
 * attempt take the page down when it does not.
 *
 * Three routes, tried in order:
 *
 *   1. A normal module worker. Works in a browser, the dev server and `serve`.
 *   2. A blob copy of the same script. Inside a VS Code webview the page lives on
 *      `vscode-webview://…` while the bundle is served from a separate resource origin, so
 *      route 1 is a cross-origin worker and the constructor throws a SecurityError. A blob URL
 *      belongs to the page's own origin, and the worker bundle has no imports of its own, so
 *      a fetched copy runs identically.
 *   3. The main thread. The layout costs milliseconds at the sizes documents reach, so this
 *      is a performance fallback, not a degraded mode.
 *
 * The original version tried route 1 inside an effect with nothing around it. The throw
 * escaped the effect, and with no error boundary React unmounted the whole app — the blank
 * page seen when switching to 3D inside the editor.
 */

type Mode = 'starting' | 'worker' | 'main-thread'

async function blobWorker(url: string): Promise<Worker> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`could not fetch the layout worker: ${response.status}`)
  const source = await response.text()
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(blobUrl, { type: 'module' })
  // The worker has already loaded the script by the time it answers; the URL can go.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
  return worker
}

export function useLayout3D(graph: Graph | null): LayoutResult | null {
  const [result, setResult] = useState<LayoutResult | null>(null)
  const [mode, setMode] = useState<Mode>(() =>
    typeof Worker === 'undefined' ? 'main-thread' : 'starting',
  )
  const workerRef = useRef<Worker | null>(null)
  const latest = useRef(0)

  // Worker lifecycle: started once, independent of which graph is showing. Keyed on nothing
  // so that switching mode after a failure does not tear down and restart it in a loop.
  useEffect(() => {
    if (typeof Worker === 'undefined') return
    let cancelled = false

    const toMainThread = (reason: unknown) => {
      console.warn('[flow-visualizer] layout worker unavailable, using the main thread:', reason)
      if (!cancelled) setMode('main-thread')
    }

    const adopt = (worker: Worker) => {
      if (cancelled) {
        worker.terminate()
        return
      }
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data
        if (!message || message.requestId < latest.current) return
        if (message.type === 'result') {
          const { type: _type, requestId: _requestId, ...layout } = message
          setResult(layout as LayoutResult)
        } else if (message.type === 'error') {
          console.error('[flow-visualizer] layout worker:', message.message)
        }
      }
      // A worker can also fail after construction — a blocked or missing script reports here
      // rather than throwing. Same answer: finish the job on the main thread.
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault()
        worker.terminate()
        workerRef.current = null
        toMainThread(event.message || 'worker error')
      }
      setMode('worker')
    }

    try {
      adopt(new Worker(workerUrl, { type: 'module' }))
    } catch (direct) {
      blobWorker(workerUrl).then(adopt, (viaBlob: unknown) => toMainThread(viaBlob ?? direct))
    }

    return () => {
      cancelled = true
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!graph) {
      setResult(null)
      return
    }
    if (mode === 'starting') return

    const worker = workerRef.current
    if (mode === 'main-thread' || !worker) {
      setResult(computeLayout(graph))
      return
    }
    latest.current += 1
    worker.postMessage({ type: 'layout', requestId: latest.current, graph })
  }, [graph, mode])

  return result
}
