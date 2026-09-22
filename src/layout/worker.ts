/// <reference lib="webworker" />
/**
 * The worker is a message loop and nothing else — zero algorithm lives here, so the layout
 * that the tests exercise is byte-for-byte the layout the browser runs.
 *
 * Cancellation is last-write-wins on both sides rather than an interruptible job. At the
 * measured cost (a few milliseconds even at 2000 nodes) an abortable stage driver would be
 * more machinery than the work it guards: the worker simply drops a request superseded
 * before it started, and the main thread drops any reply older than its latest request.
 * Because the pipeline is non-iterative there are no settling frames to stream either — a
 * hot reload produces one clean transition instead of a visible re-simulation.
 */

import { parseGraph } from '../schema/graph.js'
import { computeLayout } from './index.js'
import type { LayoutResult } from './types.js'

export interface LayoutRequest {
  type: 'layout'
  requestId: number
  /** The parsed graph, structured-cloned from the main thread. */
  graph: unknown
}

export type LayoutResponse =
  | ({ type: 'result'; requestId: number } & LayoutResult)
  | { type: 'error'; requestId: number; message: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
let latestRequestId = 0

scope.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const request = event.data
  if (request?.type !== 'layout') return

  latestRequestId = Math.max(latestRequestId, request.requestId)
  // A request already superseded while queued is dropped without doing the work.
  if (request.requestId < latestRequestId) return

  try {
    const result = computeLayout(parseGraph(request.graph))
    const response: LayoutResponse = { type: 'result', requestId: request.requestId, ...result }
    // The typed arrays transfer with zero copy; everything else clones.
    scope.postMessage(response, [result.positions.buffer, result.slots.buffer])
  } catch (error) {
    scope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    } satisfies LayoutResponse)
  }
}
