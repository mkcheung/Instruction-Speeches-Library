import { useEffect, useMemo, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'

export function VoiceWaveformPreview({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const url = useMemo(() => URL.createObjectURL(blob), [blob])

  useEffect(() => {
    const container = containerRef.current
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
    }
  }, [url])

  return (
    <div className="min-w-0 space-y-2" aria-label="Voice note preview">
      <div ref={containerRef} className="w-full overflow-hidden rounded-md border border-border" aria-hidden="true" />
      <audio className="w-full" controls preload="metadata" src={url} aria-label="Preview voice note" />
    </div>
  )
}
