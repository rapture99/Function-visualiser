import { useCallback, useEffect, useRef, useState } from 'react'
import { stepAt, type Timeline } from './timeline.js'

/**
 * Drives a timeline from a requestAnimationFrame clock.
 *
 * The step index lives in React state, because that is what the panels and the highlight
 * need and it changes roughly once a second. The continuous progress does NOT: it is written
 * straight to a DOM node through a ref inside the frame loop, so a sixty-hertz scrub bar
 * never triggers a React render. Putting elapsed time in state is the obvious way to write
 * this and it re-renders the entire graph sixty times a second.
 */

export interface PlaybackControls {
  /** Current step, or -1 when there is nothing to play. */
  index: number
  playing: boolean
  speed: number
  /** Attach to the element whose width shows progress. */
  progressRef: (node: HTMLElement | null) => void
  play: () => void
  pause: () => void
  toggle: () => void
  next: () => void
  previous: () => void
  restart: () => void
  seekToStep: (index: number) => void
  setSpeed: (speed: number) => void
}

const REDUCED_MOTION =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function usePlayback(timeline: Timeline | null): PlaybackControls {
  const [index, setIndex] = useState(timeline ? 0 : -1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(1)

  const elapsed = useRef(0)
  const lastFrame = useRef(0)
  const frame = useRef(0)
  const progressNode = useRef<HTMLElement | null>(null)

  const progressRef = useCallback((node: HTMLElement | null) => {
    progressNode.current = node
  }, [])

  // A new workflow starts from the top, stopped — autoplaying on selection would take the
  // camera away from someone who only wanted to look at the shape of the flow.
  useEffect(() => {
    elapsed.current = 0
    setIndex(timeline && timeline.steps.length > 0 ? 0 : -1)
    setPlaying(false)
  }, [timeline])

  const paint = useCallback(
    (value: number) => {
      const node = progressNode.current
      if (!node || !timeline || timeline.duration === 0) return
      node.style.width = `${Math.min(100, (value / timeline.duration) * 100)}%`
    },
    [timeline],
  )

  useEffect(() => {
    if (!playing || !timeline) return

    lastFrame.current = performance.now()
    const tick = (now: number) => {
      const delta = (now - lastFrame.current) * speed
      lastFrame.current = now
      elapsed.current = Math.min(timeline.duration, elapsed.current + delta)
      paint(elapsed.current)

      const at = stepAt(timeline, elapsed.current)
      setIndex((current) => (current === at ? current : at))

      if (elapsed.current >= timeline.duration) {
        setPlaying(false)
        return
      }
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [playing, speed, timeline, paint])

  const goTo = useCallback(
    (target: number) => {
      if (!timeline || timeline.steps.length === 0) return
      const clamped = Math.max(0, Math.min(timeline.steps.length - 1, target))
      const step = timeline.steps[clamped]!
      elapsed.current = step.start
      paint(elapsed.current)
      setIndex(clamped)
    },
    [timeline, paint],
  )

  return {
    index,
    playing,
    speed,
    progressRef,
    play: () => {
      if (!timeline) return
      // Replaying from the end should start over rather than sit finished.
      if (elapsed.current >= timeline.duration) {
        elapsed.current = 0
        setIndex(0)
      }
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    toggle: () => setPlaying((current) => !current),
    next: () => {
      setPlaying(false)
      goTo(index + 1)
    },
    previous: () => {
      setPlaying(false)
      goTo(index - 1)
    },
    restart: () => {
      setPlaying(false)
      goTo(0)
    },
    seekToStep: (target: number) => {
      setPlaying(false)
      goTo(target)
    },
    setSpeed: setSpeedState,
  }
}

/** True when the viewer should cut between states rather than animate. */
export const prefersReducedMotion = REDUCED_MOTION
