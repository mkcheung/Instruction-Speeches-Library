import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'

export function VoiceWaveformPreview({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)

  // Created and revoked inside the same effect, so React's dev-mode
  // mount/cleanup/mount cycle can never leave the <audio> (or WaveSurfer)
  // pointing at an already-revoked blob URL, as a memoized URL would.
  useEffect(() => {
    const container = containerRef.current
    const url = URL.createObjectURL(blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL's lifetime must match this effect's
    setUrl(url)
    const waveform = container
      ? WaveSurfer.create({
          container,
          url,
          height: 56,
          waveColor: '#6b6375',
          progressColor: '#6d28d9',
          cursorColor: '#6d28d9',
          normalize: true,
        })
      : null

    return () => {
      waveform?.destroy()
      URL.revokeObjectURL(url)
      setUrl(null)
    }
  }, [blob])

  return (
    <div className="min-w-0 space-y-2" aria-label="Voice note preview">
      <div ref={containerRef} className="w-full overflow-hidden rounded-md border border-border" aria-hidden="true" />
      <audio className="w-full" controls preload="metadata" src={url ?? undefined} aria-label="Preview voice note" />
    </div>
  )
}
