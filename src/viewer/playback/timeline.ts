/**
 * Compiling a workflow into a playable timeline.
 *
 * Deliberately computed once, up front, rather than derived per frame. A workflow is a fixed
 * ordered list, so its schedule is knowable in advance — which makes scrubbing free, makes
 * the whole thing testable without a clock, and keeps the animation loop down to "look up
 * which step this timestamp falls in".
 */

import type { Workflow, WorkflowError } from '../../schema/graph.js'

/** How long one step holds before advancing, at 1x. */
export const MS_PER_STEP = 1400

export interface TimelineStep {
  order: number
  nodeId: string
  note?: string
  role?: string
  /** The edge travelled to reach this step. Absent on the first. */
  edgeId?: string
  start: number
  end: number
}

export interface Timeline {
  workflowId: string
  name: string
  steps: TimelineStep[]
  errors: WorkflowError[]
  duration: number
}

export function compileTimeline(workflow: Workflow, msPerStep = MS_PER_STEP): Timeline {
  const steps: TimelineStep[] = workflow.steps.map((step, index) => ({
    order: step.order,
    nodeId: step.nodeId,
    ...(step.note ? { note: step.note } : {}),
    ...(step.role ? { role: step.role } : {}),
    // The edge that *arrives* at this step is the one leaving the previous one.
    ...(index > 0 && workflow.steps[index - 1]?.edgeId
      ? { edgeId: workflow.steps[index - 1]!.edgeId! }
      : {}),
    start: index * msPerStep,
    end: (index + 1) * msPerStep,
  }))

  return {
    workflowId: workflow.id,
    name: workflow.name,
    steps,
    errors: workflow.errors,
    duration: steps.length * msPerStep,
  }
}

/** Which step a timestamp falls in. Clamped, so scrubbing past either end is harmless. */
export function stepAt(timeline: Timeline, elapsed: number): number {
  if (timeline.steps.length === 0) return -1
  if (elapsed <= 0) return 0
  const last = timeline.steps.length - 1
  if (elapsed >= timeline.duration) return last
  const index = Math.floor(elapsed / (timeline.duration / timeline.steps.length))
  return Math.min(last, Math.max(0, index))
}

/** Everything reached up to and including a step — what playback leaves lit behind it. */
export function visitedThrough(timeline: Timeline, index: number): Set<string> {
  const visited = new Set<string>()
  for (let i = 0; i <= index && i < timeline.steps.length; i++) {
    visited.add(timeline.steps[i]!.nodeId)
  }
  return visited
}

/** Edges travelled up to and including a step, for lighting the path. */
export function traversedThrough(timeline: Timeline, index: number): Set<string> {
  const edges = new Set<string>()
  for (let i = 1; i <= index && i < timeline.steps.length; i++) {
    const edgeId = timeline.steps[i]!.edgeId
    if (edgeId) edges.add(edgeId)
  }
  return edges
}

/** Error branches hanging off a step, so playback can surface them as it passes. */
export function errorsAt(timeline: Timeline, index: number): WorkflowError[] {
  const step = timeline.steps[index]
  if (!step) return []
  return timeline.errors.filter((error) => error.atNodeId === step.nodeId)
}
