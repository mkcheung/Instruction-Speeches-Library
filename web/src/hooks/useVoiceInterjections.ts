import { useCallback, useEffect, useRef, useState } from 'react'
import { crossedNotes } from '@/lib/crossedNotes'
import { useLazyGetVoiceAudioUrlQuery } from '@/features/annotation/annotationApi'
import type { Annotation, VoiceCommentaryMode } from '@/features/annotation/types'

type InterjectionState = 'idle' | 'hinting' | 'loading' | 'playing' | 'paused' | 'recovering'

export function useVoiceInterjections({
  speechId,
  videoEl,
  notes,
  mode,
  onExperienced,
  resetKey,
}: {
  speechId: number
  videoEl: HTMLVideoElement | null
  notes: readonly Annotation[]
  mode: VoiceCommentaryMode
  onExperienced: () => void
  resetKey: string | number
}) {
  const [state, setState] = useState<InterjectionState>('idle')
  const [current, setCurrent] = useState<Annotation | null>(null)
  const [hint, setHint] = useState<Annotation | null>(null)
  const [loadAudioUrl] = useLazyGetVoiceAudioUrlQuery()
  const queueRef = useRef<Annotation[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const prevTimeRef = useRef(0)
  /** Which element `prevTimeRef` was seeded for — see the listener effect. */
  const trackedVideoRef = useRef<HTMLVideoElement | null>(null)
  const startedRef = useRef(false)
  const resumeSuppressedRef = useRef(false)
  const videoWasPlayingRef = useRef(false)
  const safetyTimerRef = useRef<number | null>(null)
  const safetyDeadlineRef = useRef(0)
  const generationRef = useRef(0)
  const onExperiencedRef = useRef(onExperienced)
  const experienceMarkedRef = useRef(false)
  const lastModeRef = useRef(mode)
  const lastResetKeyRef = useRef(resetKey)

  useEffect(() => {
    onExperiencedRef.current = onExperienced
  }, [onExperienced])

  useEffect(() => {
    experienceMarkedRef.current = false
  }, [speechId])

  const markExperienced = useCallback(() => {
    if (experienceMarkedRef.current) return
    experienceMarkedRef.current = true
    onExperiencedRef.current()
  }, [])

  const clearSafetyTimer = () => {
    if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = null
  }

  const resumeVideo = useCallback(() => {
    if (videoEl && videoWasPlayingRef.current && !resumeSuppressedRef.current) {
      void videoEl.play().catch(() => undefined)
    }
  }, [videoEl])

  const finish = useCallback(
    (resume = true) => {
      generationRef.current += 1
      clearSafetyTimer()
      safetyDeadlineRef.current = 0
      const audio = audioRef.current
      if (audio) {
        audio.onended = null
        audio.onerror = null
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      audioRef.current = null
      queueRef.current = []
      setCurrent(null)
      setState('idle')
      if (resume) resumeVideo()
    },
    [resumeVideo],
  )

  const armSafetyTimer = useCallback((milliseconds: number) => {
    clearSafetyTimer()
    safetyTimerRef.current = window.setTimeout(
      () => {
        setState('recovering')
        finish(true)
      },
      Math.max(0, milliseconds),
    )
  }, [finish])

  const playNext = useCallback(async function playNext(): Promise<void> {
    const note = queueRef.current.shift()
    if (!note) {
      markExperienced()
      finish(true)
      return
    }

    const generation = generationRef.current
    setCurrent(note)
    setState('loading')
    try {
      const response = await loadAudioUrl({ speechId, annotationId: note.id }, false).unwrap()
      if (generation !== generationRef.current) return
      const audio = new Audio(response.audio.url)
      audioRef.current = audio
      audio.onended = () => {
        clearSafetyTimer()
        markExperienced()
        void playNext()
      }
      audio.onerror = () => {
        setState('recovering')
        finish(true)
      }
      await audio.play()
      if (generation !== generationRef.current) return
      setState('playing')
      const safetyWindow = Math.max(0.001, note.duration_seconds) * 1000 + 3000
      safetyDeadlineRef.current = Date.now() + safetyWindow
      armSafetyTimer(safetyWindow)
    } catch {
      setState('recovering')
      finish(true)
    }
  }, [armSafetyTimer, finish, loadAudioUrl, markExperienced, speechId])

  const startQueue = useCallback(
    (crossed: readonly Annotation[]) => {
      if (!videoEl || crossed.length === 0 || queueRef.current.length > 0 || current) return
      generationRef.current += 1
      queueRef.current = [...crossed]
      videoWasPlayingRef.current = !videoEl.paused
      resumeSuppressedRef.current = false
      videoEl.pause()
      void playNext()
    },
    [current, playNext, videoEl],
  )

  useEffect(() => {
    if (!videoEl) return
    // Seed the crossing window ONLY when we start tracking a new element.
    // This effect re-runs on every render — its `notes` dep is a fresh
    // `filter()` array from useCommentaryTrack and there is no React
    // Compiler in this build — and re-seeding `prevTimeRef` to the LIVE
    // currentTime on each of those runs narrowed the [prevTime, now] window
    // `crossedNotes` inspects. A note whose start fell inside the swallowed
    // gap was then skipped permanently, since prevTime only moves forward:
    // the video simply never paused and the coach's audio never played,
    // with nothing surfaced to the viewer. The play/seeking/timeupdate
    // handlers below own this ref from here on.
    if (trackedVideoRef.current !== videoEl) {
      trackedVideoRef.current = videoEl
      prevTimeRef.current = videoEl.currentTime
    }

    const onPlay = () => {
      // Native/video.js controls remain operable while commentary owns the
      // audio focus. A user play gesture during an interjection is treated
      // as manual playback intent: keep the video paused under the voice and
      // do not auto-resume it when that voice ends.
      if (audioRef.current) {
        resumeSuppressedRef.current = true
        videoEl.pause()
        return
      }
      prevTimeRef.current = videoEl.currentTime
      startedRef.current = videoEl.currentTime > 0
    }
    const onSeeking = () => {
      prevTimeRef.current = videoEl.currentTime
    }
    const onTime = () => {
      const now = videoEl.currentTime
      const playable = notes.filter((note) => note.voice?.audio_status === 'ready')
      const nextHint = mode === 'play'
        ? playable.find((note) => note.start_seconds > now && note.start_seconds <= now + 3) ?? null
        : null
      setHint(nextHint)
      if (mode === 'play' && !videoEl.seeking) {
        startQueue(crossedNotes(playable, prevTimeRef.current, now, startedRef.current))
      }
      prevTimeRef.current = now
      startedRef.current = true
    }

    videoEl.addEventListener('play', onPlay)
    videoEl.addEventListener('seeking', onSeeking)
    videoEl.addEventListener('seeked', onSeeking)
    videoEl.addEventListener('timeupdate', onTime)
    return () => {
      videoEl.removeEventListener('play', onPlay)
      videoEl.removeEventListener('seeking', onSeeking)
      videoEl.removeEventListener('seeked', onSeeking)
      videoEl.removeEventListener('timeupdate', onTime)
    }
  }, [mode, notes, startQueue, videoEl])

  useEffect(() => {
    if (mode === lastModeRef.current) return
    lastModeRef.current = mode
    if (mode !== 'play') {
      setHint(null)
      queueMicrotask(() => finish(true))
    }
  }, [mode, finish])

  useEffect(() => {
    if (resetKey === lastResetKeyRef.current) return
    lastResetKeyRef.current = resetKey
    queueMicrotask(() => finish(true))
  }, [resetKey, finish])

  useEffect(
    () => () => {
      generationRef.current += 1
      if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current)
      safetyDeadlineRef.current = 0
      const audio = audioRef.current
      if (audio) {
        audio.onended = null
        audio.onerror = null
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      audioRef.current = null
      queueRef.current = []
    },
    [],
  )

  const skip = useCallback(() => {
    if (!current) return
    markExperienced()
    finish(true)
  }, [current, finish, markExperienced])

  useEffect(() => {
    if (!current) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, skip])

  const pauseCommentary = () => {
    const audio = audioRef.current
    if (!audio || audio.paused) return
    resumeSuppressedRef.current = true
    audio.pause()
    clearSafetyTimer()
    setState('paused')
  }

  const resumeCommentary = async () => {
    const audio = audioRef.current
    if (!audio || !audio.paused) return
    try {
      await audio.play()
      setState('playing')
      const remaining = safetyDeadlineRef.current - Date.now()
      if (remaining <= 0) {
        finish(true)
        return
      }
      armSafetyTimer(remaining)
    } catch {
      finish(true)
    }
  }

  return {
    state: hint && state === 'idle' ? ('hinting' as const) : state,
    current,
    hint,
    skip,
    pauseCommentary,
    resumeCommentary,
  }
}
