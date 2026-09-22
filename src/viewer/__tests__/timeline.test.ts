import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '../../parser/index.js'
import {
  MS_PER_STEP,
  compileTimeline,
  errorsAt,
  stepAt,
  traversedThrough,
  visitedThrough,
} from '../playback/timeline.js'

const graph = parse(
  readFileSync(
    fileURLToPath(new URL('../../testing/fixtures/sample-system.md', import.meta.url)),
    'utf8',
  ),
  'sample-system.md',
).graph

const workflow = graph.workflows.find((w) => w.id === 'apply-leave')!
const timeline = compileTimeline(workflow)

describe('compileTimeline', () => {
  it('schedules every step back to back', () => {
    expect(timeline.steps).toHaveLength(workflow.steps.length)
    expect(timeline.duration).toBe(workflow.steps.length * MS_PER_STEP)
    for (let i = 1; i < timeline.steps.length; i++) {
      expect(timeline.steps[i]!.start).toBe(timeline.steps[i - 1]!.end)
    }
  })

  it('attaches the edge that ARRIVES at each step, not the one leaving it', () => {
    // Playback lights the connection it just travelled; using the outgoing edge would
    // illuminate the next hop a step early.
    expect(timeline.steps[0]!.edgeId).toBeUndefined()
    for (let i = 1; i < timeline.steps.length; i++) {
      expect(timeline.steps[i]!.edgeId).toBe(workflow.steps[i - 1]!.edgeId)
    }
  })

  it('carries the acting role through, including the handover', () => {
    // The sample hands from Employee to Admin partway through.
    expect(timeline.steps[0]!.role).toBe('Employee')
    expect(timeline.steps.at(-1)!.role).toBe('Admin')
  })

  it('scales with speed without changing the order', () => {
    const fast = compileTimeline(workflow, 100)
    expect(fast.duration).toBe(workflow.steps.length * 100)
    expect(fast.steps.map((s) => s.nodeId)).toEqual(timeline.steps.map((s) => s.nodeId))
  })
})

describe('stepAt', () => {
  it('maps a timestamp to the step holding it', () => {
    expect(stepAt(timeline, 0)).toBe(0)
    expect(stepAt(timeline, MS_PER_STEP * 0.5)).toBe(0)
    expect(stepAt(timeline, MS_PER_STEP * 1.5)).toBe(1)
  })

  it('clamps at both ends, so scrubbing past either edge is harmless', () => {
    expect(stepAt(timeline, -5000)).toBe(0)
    expect(stepAt(timeline, timeline.duration * 10)).toBe(timeline.steps.length - 1)
  })

  it('returns -1 for a workflow with no steps', () => {
    expect(stepAt({ ...timeline, steps: [], duration: 0 }, 0)).toBe(-1)
  })
})

describe('what playback leaves lit', () => {
  it('accumulates nodes rather than showing one at a time', () => {
    expect(visitedThrough(timeline, 0).size).toBe(1)
    expect(visitedThrough(timeline, 3).size).toBe(4)
    expect(visitedThrough(timeline, timeline.steps.length - 1).size).toBe(
      new Set(timeline.steps.map((s) => s.nodeId)).size,
    )
  })

  it('lights one fewer edge than nodes, since the first step is arrived at from nowhere', () => {
    expect(traversedThrough(timeline, 0).size).toBe(0)
    expect(traversedThrough(timeline, 4).size).toBe(4)
  })

  it('surfaces the error branches hanging off the current step', () => {
    const failing = timeline.steps.findIndex((step) =>
      workflow.errors.some((error) => error.atNodeId === step.nodeId),
    )
    expect(failing).toBeGreaterThanOrEqual(0)
    expect(errorsAt(timeline, failing).length).toBeGreaterThan(0)
    // A step with no declared failure reports none rather than guessing.
    const clean = timeline.steps.findIndex(
      (step) => !workflow.errors.some((error) => error.atNodeId === step.nodeId),
    )
    expect(errorsAt(timeline, clean)).toEqual([])
  })
})
