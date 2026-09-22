import type { PlaybackControls } from './usePlayback.js'
import { errorsAt, type Timeline } from './timeline.js'

const SPEEDS = [0.5, 1, 2, 4]

export interface PlaybackBarProps {
  timeline: Timeline
  playback: PlaybackControls
  onSelectNode: (id: string) => void
  nameOf: (id: string) => string
}

/**
 * Transport for a workflow.
 *
 * The step list is clickable rather than decorative: reading the flow and scrubbing to a
 * point in it are the same action, and someone navigating by keyboard gets the whole
 * workflow as ordinary buttons rather than a timeline they cannot reach.
 */
export function PlaybackBar({ timeline, playback, onSelectNode, nameOf }: PlaybackBarProps) {
  const current = timeline.steps[playback.index]
  const errors = errorsAt(timeline, playback.index)

  return (
    <div className="playback">
      <div className="playback-transport">
        <button type="button" className="pill" onClick={playback.restart} title="Back to the start">
          ⏮
        </button>
        <button type="button" className="pill" onClick={playback.previous} title="Previous step">
          ◀
        </button>
        <button
          type="button"
          className="pill primary"
          onClick={playback.toggle}
          title={playback.playing ? 'Pause' : 'Play'}
        >
          {playback.playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" className="pill" onClick={playback.next} title="Next step">
          ▶
        </button>

        <span className="playback-count">
          {playback.index + 1} / {timeline.steps.length}
        </span>

        <span className="playback-speeds">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className="pill"
              aria-pressed={playback.speed === speed}
              onClick={() => playback.setSpeed(speed)}
            >
              {speed}×
            </button>
          ))}
        </span>
      </div>

      <div className="playback-track">
        <div className="playback-fill" ref={playback.progressRef} />
      </div>

      {current ? (
        <p className="playback-now" aria-live="polite">
          <strong>{nameOf(current.nodeId)}</strong>
          {current.role ? <span className="playback-role">{current.role}</span> : null}
          {current.note ? <span className="playback-note">{current.note}</span> : null}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <p className="playback-errors">
          {errors.length === 1 ? 'Can fail here: ' : 'Can fail here: '}
          {errors.map((error) => error.reason).join(' · ')}
        </p>
      ) : null}

      <ol className="playback-steps">
        {timeline.steps.map((step, index) => (
          <li key={`${step.order}-${step.nodeId}`}>
            <button
              type="button"
              className={`playback-step${index === playback.index ? ' current' : ''}${
                index < playback.index ? ' done' : ''
              }`}
              onClick={() => {
                playback.seekToStep(index)
                onSelectNode(step.nodeId)
              }}
            >
              <span className="playback-order">{step.order}</span>
              {nameOf(step.nodeId)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
