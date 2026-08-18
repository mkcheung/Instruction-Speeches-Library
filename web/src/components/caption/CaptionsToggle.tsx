import { useReducer } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Imperative DOM/TextTrack write, not a React state mutation — pulled out
 * to module scope for the same reason `SpeechWatch.tsx`'s own `seekVideo`
 * is: the compiler's props/hook-argument immutability check would
 * otherwise mistake writing `track.mode` (a prop) for a React immutability
 * bug, when `track` is really a live handle onto browser media state that
 * nothing in React owns.
 */
function setTrackMode(track: TextTrack, mode: TextTrackMode): void {
  track.mode = mode
}

/**
 * STEP-09-captions.md's acceptance list: "Captions and annotations are on
 * different tracks and toggle independently." This toggles the native
 * `TextTrack.mode` directly (`'showing'` <-> `'disabled'`) — nothing about
 * the annotation overlay's own on/off state lives here or is read here.
 *
 * `track` is `null` until `SpeechWatch` has both a ready player and a
 * ready caption job (`useCaptionsJob`/`setCaptionsTrack` in
 * `videojs-adapter.ts`) — the button renders nothing until then, matching
 * the demo script's "a few minutes later, the `CC` button lights up"
 * rather than showing a permanently-disabled button.
 *
 * `track.mode` is read fresh on every render rather than mirrored into
 * `useState` (which would need an effect just to resync when `track`
 * itself changes identity, e.g. once the job finishes and a track first
 * appears — a bare derived-state effect this repo's lint flags). A
 * `useReducer` counter forces a re-render after this component's OWN
 * mutation, since assigning `.mode` on a plain object doesn't itself
 * trigger React to notice.
 */
export function CaptionsToggle({ track }: { track: TextTrack | null }) {
  const [, forceRender] = useReducer((count: number) => count + 1, 0)

  if (!track) return null

  const showing = track.mode === 'showing'

  const toggle = () => {
    setTrackMode(track, showing ? 'disabled' : 'showing')
    forceRender()
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={showing ? 'default' : 'outline'}
      aria-pressed={showing}
      data-testid="captions-toggle"
      onClick={toggle}
    >
      {showing ? 'Captions on' : 'Captions off'}
    </Button>
  )
}
