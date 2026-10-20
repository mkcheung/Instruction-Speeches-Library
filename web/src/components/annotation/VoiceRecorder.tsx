import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VoiceWaveformPreview } from '@/components/annotation/VoiceWaveformPreview'
import { useCreateVoiceAnnotationMutation } from '@/features/annotation/annotationApi'
import { startMediaRecorderWithFallback, stopMediaStream } from '@/lib/mediaRecorder'
import { captureAnnotationTime, formatAnnotationTime, validateAnnotationPoint } from '@/lib/annotationTiming'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { newClientUuid } from '@/lib/uuid'

const MAX_RECORDING_MS = 90_000
type RecorderState = 'idle' | 'requesting' | 'recording' | 'preview' | 'denied' | 'no-device' | 'unsupported' | 'error'
interface VoiceSubmission { audio: Blob; clientUuid: string; startMs: number }
function useVideoPaused(videoEl: HTMLVideoElement | null): boolean {
  const [paused, setPaused] = useState(() => videoEl?.paused ?? true)
  useEffect(() => {
    if (!videoEl) return
    const update = () => setPaused(videoEl.paused)
    update()
    for (const name of ['play', 'pause', 'ended']) videoEl.addEventListener(name, update)
    return () => { for (const name of ['play', 'pause', 'ended']) videoEl.removeEventListener(name, update) }
  }, [videoEl])
  return paused
}

export function VoiceRecorder({ speechId, reviewId, videoEl, durationMs = null, annotations, writable = true, onPendingChange }: {
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  durationMs?: number | null
  annotations?: readonly Annotation[]
  writable?: boolean
  onPendingChange?: (id: string, pending: boolean) => void
}) {
  const [instanceId] = useState(newClientUuid)
  const inputId = useId()
  const [state, setState] = useState<RecorderState>('idle')
  const [blob, setBlob] = useState<Blob | null>(null)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [position, setPosition] = useState(() => {
    const time = videoEl ? captureAnnotationTime(videoEl.currentTime, durationMs, videoEl.ended) : null
    return time === null ? '' : formatAnnotationTime(time)
  })
  const [message, setMessage] = useState<string | null>(null)
  const positionEditedRef = useRef(false)
  const [uncertain, setUncertain] = useState<VoiceSubmission | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef('application/octet-stream')
  const startedAtRef = useRef(0)
  const clientUuidRef = useRef<string | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const uncertainRef = useRef<VoiceSubmission | null>(null)
  const paused = useVideoPaused(videoEl)
  const recordingApiAvailable = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof globalThis.MediaRecorder === 'function'
  const [createVoice, { isLoading: isSaving }] = useCreateVoiceAnnotationMutation()
  const validation = validateAnnotationPoint(position, durationMs, annotations)
  // The initial position is read at mount, but the speech's duration (and so
  // a valid capture) can arrive afterwards; without this, a slow load left the
  // field empty and Record disabled until the user typed or pressed "Use current time".
  useEffect(() => {
    if (positionEditedRef.current || position !== '' || !videoEl) return
    const time = captureAnnotationTime(videoEl.currentTime, durationMs, videoEl.ended)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing to an external value (the video's duration) that arrives after mount
    if (time !== null) setPosition(formatAnnotationTime(time))
  }, [durationMs, position, videoEl])
  const frozen = isSaving || uncertain !== null || state === 'requesting' || state === 'recording'
  const pending = blob !== null || isSaving || uncertain !== null || state === 'requesting' || state === 'recording'
  useEffect(() => { onPendingChange?.(instanceId, pending) }, [onPendingChange, instanceId, pending])
  useEffect(() => () => { onPendingChange?.(instanceId, false) }, [onPendingChange, instanceId])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current)
      stopMediaStream(streamRef.current)
    }
  }, [])
  useEffect(() => {
    if (!pending) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [pending])

  const clearTimer = () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
  }
  const releaseMic = () => {
    clearTimer(); stopMediaStream(streamRef.current); streamRef.current = null; recorderRef.current = null
  }
  const stop = () => { clearTimer(); if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }
  const record = async () => {
    if (!videoEl?.paused || !validation.valid || !writable || busyRef.current || blob || frozen) return
    if (!recordingApiAvailable) { setState('unsupported'); return }
    // Capture the visible position before asking for permission. A delayed grant
    // must not move the voice note to wherever the playhead has since gone.
    const anchorMs = validation.startMs!
    busyRef.current = true; setState('requesting'); setMessage(null)
    chunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false })
      if (!mountedRef.current) { stopMediaStream(stream); return }
      streamRef.current = stream
      startedAtRef.current = performance.now(); clientUuidRef.current = newClientUuid()
      setPosition(formatAnnotationTime(anchorMs))
      const started = startMediaRecorderWithFallback(stream, {
        onDataAvailable: (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) },
        onStop: () => {
          if (!mountedRef.current) return
          const duration = Math.max(0.001, Math.min(90, (performance.now() - startedAtRef.current) / 1000))
          const recording = new Blob(chunksRef.current, { type: mimeTypeRef.current })
          setDurationSeconds(Math.round(duration * 1000) / 1000); setBlob(recording)
          setState(recording.size > 0 ? 'preview' : 'error'); releaseMic()
        },
        onError: () => { if (mountedRef.current) setState('error'); releaseMic() },
      })
      if (!started) { releaseMic(); setState('unsupported'); return }
      recorderRef.current = started.recorder; mimeTypeRef.current = started.mimeType
      setState('recording'); stopTimerRef.current = window.setTimeout(stop, MAX_RECORDING_MS)
    } catch (error) {
      releaseMic()
      if (mountedRef.current) setState(error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied'
        : error instanceof DOMException && error.name === 'NotFoundError' ? 'no-device' : 'error')
    } finally { busyRef.current = false }
  }
  const discard = () => {
    if (busyRef.current || uncertainRef.current || state === 'requesting' || state === 'recording') return
    setBlob(null); setDurationSeconds(0); clientUuidRef.current = null; setState('idle'); setMessage(null)
  }
  const capture = () => {
    if (!videoEl || frozen || busyRef.current) return
    const time = captureAnnotationTime(videoEl.currentTime, durationMs, videoEl.ended)
    if (time === null) { setMessage('Choose a position within the speech.'); return }
    positionEditedRef.current = true; videoEl.pause(); setPosition(formatAnnotationTime(time)); setMessage(null)
  }
  const acknowledge = (saved: Annotation, submission: VoiceSubmission): boolean => {
    if (saved.client_uuid !== submission.clientUuid || Math.round(saved.start_seconds * 1000) !== submission.startMs || !isPointAnnotation(saved)) return false
    uncertainRef.current = null; setUncertain(null); setBlob(null); setDurationSeconds(0)
    clientUuidRef.current = null; setState('idle'); setMessage(`Voice note saved at ${formatAnnotationTime(submission.startMs)}.`)
    return true
  }
  const save = async () => {
    if (!blob || !clientUuidRef.current || busyRef.current || !writable || (!uncertainRef.current && !validation.valid)) return
    const submission = uncertainRef.current ?? { audio: blob, clientUuid: clientUuidRef.current, startMs: validation.startMs! }
    const wasUncertain = uncertainRef.current !== null
    busyRef.current = true; setMessage(null)
    try {
      const saved = await createVoice({ speechId, reviewId,
        body: { audio: submission.audio, client_uuid: submission.clientUuid, start_seconds: submission.startMs / 1000 } }).unwrap()
      if (!mountedRef.current) return
      if (!acknowledge(saved, submission)) throw { status: 'ACK_MISMATCH' }
    } catch (error) {
      if (!mountedRef.current) return
      const failure = error as { status?: number | string; data?: { code?: string; message?: string } }
      const definitive = (!wasUncertain && ((typeof failure.status === 'number' && failure.status >= 400 && failure.status < 500) || failure.data?.code === 'annotation_busy'))
        || (failure.status === 422 && failure.data?.code === 'annotation_overlap')
      if (definitive) {
        uncertainRef.current = null; setUncertain(null)
        setMessage(failure.data?.code === 'annotation_overlap' ? 'This position is occupied. Change Voice note position and save the same recording again.'
          : failure.data?.message ?? 'Could not save this recording. Check the position and retry; your recording is retained.')
      } else {
        uncertainRef.current = submission; setUncertain(submission)
        setMessage('The upload outcome is uncertain. Retry the original upload before changing its position or discarding the recording. Keep this page open.')
      }
      setState('error')
    } finally { busyRef.current = false }
  }
  // Presence of the exact UUID/point proves admission. Absence from a poll does
  // not prove failure and never unfreezes an uncertain recording.
  useEffect(() => {
    if (!uncertain || isSaving) return
    const admitted = annotations?.find((note) => note.client_uuid === uncertain.clientUuid)
    // A matching server row is external confirmation of an uncertain upload.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (admitted) acknowledge(admitted, uncertain)
  }, [annotations, uncertain, isSaving])

  if (!recordingApiAvailable || state === 'unsupported') return <p className="text-sm text-muted-foreground">Voice recording is not supported by this browser.</p>
  return <section className="min-w-0 space-y-2 rounded-md border border-border p-3" aria-label="Record a voice note">
    <label htmlFor={inputId} className="block text-sm font-medium">Voice note position</label>
    <div className="flex flex-wrap gap-2">
      <input id={inputId} type="text" inputMode="decimal" value={position} disabled={frozen} className="h-9 w-36 rounded-md border border-input px-2 text-sm"
        onChange={(event) => { if (!busyRef.current && !uncertainRef.current) { positionEditedRef.current = true; setPosition(event.target.value); setMessage(null) } }} />
      <Button type="button" variant="outline" disabled={frozen} onClick={capture} aria-label="Use current time for voice note">Use current time</Button>
    </div>
    {validation.message && !uncertain && <p role="status" className="text-sm text-muted-foreground">{validation.message}</p>}
    <div className="flex min-h-11 flex-wrap items-center gap-2">
      {!blob && ['idle', 'denied', 'no-device', 'error'].includes(state) && paused && <Button type="button" variant="outline" className="min-h-11" disabled={!validation.valid || !writable} onClick={() => void record()}>Record <span aria-hidden="true" className="text-[var(--color-danger)]">●</span></Button>}
      {state === 'requesting' && <span role="status">Requesting microphone access…</span>}
      {state === 'recording' && <><span role="status">Recording… 90 second maximum.</span><Button type="button" className="min-h-11" onClick={stop}>Stop</Button></>}
      {state === 'idle' && !paused && <span className="text-sm text-muted-foreground">Pause the video to record a voice note.</span>}
    </div>
    {state === 'denied' && <p role="alert" className="text-sm text-[var(--color-danger)]">Microphone access is blocked. Allow microphone access for this site in your browser settings, then try again.</p>}
    {state === 'no-device' && <p role="alert" className="text-sm text-[var(--color-danger)]">No microphone was found. Connect or enable a microphone, then try again.</p>}
    {state === 'error' && !message && <p role="alert" className="text-sm text-[var(--color-danger)]">Could not record this voice note. Try again.</p>}
    {message && <p role={state === 'error' ? 'alert' : 'status'} className="text-sm">{message}</p>}
    {blob && <div className="space-y-2">
      <VoiceWaveformPreview blob={blob} />
      <p className="text-xs text-muted-foreground">Voice note at {position} · {durationSeconds.toFixed(1)} seconds of recorded audio</p>
      <p className="text-xs text-muted-foreground">This recording is kept in this page only. Save it before leaving or reloading.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={frozen} onClick={discard}>Re-record</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={frozen} onClick={discard}>Discard voice note</Button>
        <Button type="button" className="min-h-11" disabled={isSaving || !writable || (!uncertain && !validation.valid)} onClick={() => void save()}>{isSaving ? 'Saving…' : uncertain ? 'Retry original upload' : 'Save voice note'}</Button>
      </div>
    </div>}
  </section>
}
