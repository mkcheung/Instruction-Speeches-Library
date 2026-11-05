import type { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { handleVoiceControlsKeyDown } from '@/lib/voiceControlsKeys'

type Playback = ReturnType<typeof useVoiceInterjections>

export function VoicePlaybackControls({ playback: voicePlayback }: { playback: Playback }) {
  return <div className="flex flex-col gap-2">
      {voicePlayback.error && <p role="alert" className="text-sm text-destructive">{voicePlayback.error}</p>}
      {voicePlayback.hint && !voicePlayback.current && <p role="status" className="text-sm text-muted-foreground">🔊 Commentary ahead</p>}
      {voicePlayback.current && <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
        <span role="status" className="text-sm">{voicePlayback.state === 'loading' ? 'Loading voice commentary…'
          : voicePlayback.state === 'paused' ? 'Voice commentary paused' : 'Playing voice commentary'}</span>
        {voicePlayback.state === 'paused'
          ? <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={() => void voicePlayback.resumeCommentary()}>Resume commentary</button>
          : <button type="button" disabled={voicePlayback.state !== 'playing'} className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-50" onClick={voicePlayback.pauseCommentary}>Pause commentary</button>}
        <button type="button" className="min-h-11 rounded-md border px-3 text-sm" onClick={voicePlayback.skip}>Skip commentary</button>
      </div>}
  </div>
}

/** Floating box for HTML fullscreen: renders only while there is something to show. */
export function FullscreenVoiceControls({ playback }: { playback: Playback }) {
  if (!playback.current && !playback.hint && !playback.error) return null
  return (
    <div className="pointer-events-auto absolute bottom-12 left-3 z-30 max-w-[min(360px,calc(100%-24px))] rounded-lg border bg-background p-2 text-foreground shadow-lg"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => handleVoiceControlsKeyDown(event, playback.skip)}>
      <VoicePlaybackControls playback={playback} />
    </div>
  )
}
