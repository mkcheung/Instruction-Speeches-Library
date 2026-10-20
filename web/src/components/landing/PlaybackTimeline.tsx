import { Suspense, useId } from 'react'
import { NoteAvatar } from './lazyArt'

/** Three example reviewer notes, pinned to the second they're about. */
const NOTES = [
  { at: '0:12', text: 'Breathe here — great pause.', avatar: 'a', tilt: '-1.2deg' },
  { at: '0:42', text: 'Love this story!', avatar: 'b', tilt: '1deg' },
  { at: '1:15', text: 'Slow down a touch.', avatar: 'c', tilt: '-0.8deg' },
] as const

/**
 * Act II's example playback: a teal rail with a play-head marker, timestamp
 * pills, and a sticky note beside each.
 *
 * As each note scrolls into view it slides up into place, and the rail
 * fills in as you scroll past it. Both effects are pure CSS, gated on
 * `@supports (animation-timeline: view())` and on
 * `prefers-reduced-motion: no-preference` (see `landing.css`). Everywhere
 * else the notes and the rail are simply shown.
 */
export function PlaybackTimeline() {
  const labelId = useId()
  return (
    <div className="land-timeline">
      <div className="land-rail" aria-hidden="true">
        <div className="land-rail-fill" />
      </div>
      <div className="land-rail-end" aria-hidden="true" />
      <p id={labelId} className="land-playhead font-landing-mono">
        <svg aria-hidden="true" focusable="false" width="92" height="28" viewBox="0 0 92 28">
          <path
            d="M37,4 L57,14 L37,24 Z"
            fill="#0F6B66"
            stroke="#2B211B"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        </svg>
        Example playback
      </p>
      <ol className="land-notes" aria-labelledby={labelId}>
        {NOTES.map((note) => (
          <li key={note.at} className="land-note-row">
            <span className="land-stamp font-landing-mono">{note.at}</span>
            <div className="land-note" style={{ rotate: note.tilt }}>
              <Suspense fallback={<span className="land-avatar-fallback" aria-hidden="true" />}>
                <NoteAvatar variant={note.avatar} />
              </Suspense>
              <p className="land-note-text">{note.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
