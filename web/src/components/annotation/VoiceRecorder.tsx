import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VoiceWaveformPreview } from '@/components/annotation/VoiceWaveformPreview'
import { useCreateVoiceAnnotationMutation } from '@/features/annotation/annotationApi'
import { startMediaRecorderWithFallback, stopMediaStream } from '@/lib/mediaRecorder'

const MAX_RECORDING_MS = 90_000

type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'denied' | 'no-device' | 'unsupported' | 'error'

function useVideoPaused(videoEl: HTMLVideoElement | null): boolean {
  const [paused, setPaused] = useState(() => videoEl?.paused ?? true)
  useEffect(() => {
    if (!videoEl) return
    const update = () => setPaused(videoEl.paused)
    update()
    videoEl.addEventListener('play', update)
    videoEl.addEventListener('pause', update)
    videoEl.addEventListener('ended', update)
    return () => {
      videoEl.removeEventListener('play', update)
      videoEl.removeEventListener('pause', update)
      videoEl.removeEventListener('ended', update)
    }
  }, [videoEl])
  return paused
}

export function VoiceRecorder({
  speechId,
  reviewId,
  videoEl,
}: {
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
}) {
  const [state, setState] = useState<RecorderState>('idle')
  const [blob, setBlob] = useState<Blob | null>(null)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [startSeconds, setStartSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef('application/octet-stream')
  const startedAtRef = useRef(0)
  const clientUuidRef = useRef<string | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const paused = useVideoPaused(videoEl)
  const recordingApiAvailable =
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof globalThis.MediaRecorder === 'function'
  const [createVoice, { isLoading: isSaving }] = useCreateVoiceAnnotationMutation()

  const clearTimer = () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
  }

  const releaseMic = () => {
    clearTimer()
    stopMediaStream(streamRef.current)
    streamRef.current = null
    recorderRef.current = null
  }

  useEffect(
    () => () => {
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current)
      stopMediaStream(streamRef.current)
    },
    [],
  )

  const stop = () => {
    clearTimer()
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  const record = async () => {
    if (!videoEl || !videoEl.paused) return
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setState('unsupported')
      return
    }
    setState('requesting')
    setBlob(null)
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
      streamRef.current = stream
      const stampedAt = Math.max(0, videoEl.currentTime)
      startedAtRef.current = performance.now()
      clientUuidRef.current = crypto.randomUUID()
      setStartSeconds(Math.round(stampedAt * 1000) / 1000)

      const started = startMediaRecorderWithFallback(stream, {
        onDataAvailable: (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data)
        },
        onStop: () => {
          const duration = Math.max(0.001, Math.min(90, (performance.now() - startedAtRef.current) / 1000))
          const recording = new Blob(chunksRef.current, { type: mimeTypeRef.current })
          setDurationSeconds(Math.round(duration * 1000) / 1000)
          setBlob(recording)
          setState(recording.size > 0 ? 'preview' : 'error')
          releaseMic()
        },
        onError: () => {
          setState('error')
          releaseMic()
        },
      })
      if (!started) {
        releaseMic()
        setState('unsupported')
        return
      }
      recorderRef.current = started.recorder
      mimeTypeRef.current = started.mimeType
      setState('recording')
      stopTimerRef.current = window.setTimeout(stop, MAX_RECORDING_MS)
    } catch (error) {
      releaseMic()
      setState(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'denied'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? 'no-device'
            : 'error',
      )
    }
  }

  const rerecord = () => {
    setBlob(null)
    setDurationSeconds(0)
    clientUuidRef.current = null
    setState('idle')
  }

  const save = async () => {
    if (!blob || !clientUuidRef.current) return
    try {
      await createVoice({
        speechId,
        reviewId,
        body: {
          audio: blob,
          client_uuid: clientUuidRef.current,
          start_seconds: startSeconds,
        },
      }).unwrap()
      rerecord()
    } catch {
      setState('error')
    }
  }

  if (!recordingApiAvailable || state === 'unsupported') {
    return <p className="text-sm text-muted-foreground">Voice recording is not supported by this browser.</p>
  }

  return (
    <section className="min-w-0 space-y-2 rounded-md border border-border p-3" aria-label="Record a voice note">
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        {(state === 'idle' || state === 'denied' || state === 'no-device' || state === 'error') && paused && (
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void record()}>
            Record <span aria-hidden="true" className="text-[var(--color-danger)]">●</span>
          </Button>
        )}
        {state === 'requesting' && <span role="status">Requesting microphone access…</span>}
        {state === 'recording' && (
          <>
            <span role="status">Recording… 90 second maximum.</span>
            <Button type="button" className="min-h-11" onClick={stop}>Stop</Button>
          </>
        )}
        {state === 'idle' && !paused && (
          <span className="text-sm text-muted-foreground">Pause the video to record a voice note.</span>
        )}
      </div>

      {state === 'denied' && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          Microphone access is blocked. Allow microphone access for this site in your browser settings, then try again.
        </p>
      )}
      {state === 'no-device' && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          No microphone was found. Connect or enable a microphone, then try again.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">Could not record or save this voice note. Try again.</p>
      )}
      {blob && (
        <div className="space-y-2">
          <VoiceWaveformPreview blob={blob} />
          <p className="text-xs text-muted-foreground">
            Voice note at {startSeconds.toFixed(1)} seconds · {durationSeconds.toFixed(1)} seconds
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={rerecord}>
              Re-record
            </Button>
            <Button type="button" className="min-h-11" disabled={isSaving} onClick={() => void save()}>
              {isSaving ? 'Saving…' : 'Save voice note'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
