import type { Annotation, VoiceAudioUrlResponse } from '@/features/annotation/types'
import { crossedNotes } from '@/lib/crossedNotes'

type VoiceIdentity = { id: string; assetId: number }
export type VoicePlaybackState = 'idle' | 'hinting' | 'loading' | 'playing' | 'paused'
export interface VoicePlaybackSnapshot {
  state: VoicePlaybackState
  current: Annotation | null
  hint: Annotation | null
  error: string | null
}
export const IDLE_VOICE_PLAYBACK: VoicePlaybackSnapshot = { state: 'idle', current: null, hint: null, error: null }

/** Owns one video's interruption, cancellation, and pause ownership.
 * Both audio-enabled modes use the same instance. */
export class VoiceInterjectionController {
  private video: HTMLVideoElement
  private loadUrl: (annotationId: string) => { unwrap: () => Promise<VoiceAudioUrlResponse>; abort?: () => void }
  private snapshot: VoicePlaybackSnapshot = IDLE_VOICE_PLAYBACK
  private listeners = new Set<() => void>()
  private notes: readonly Annotation[] = []
  private enabled = false
  private connected = false
  private generation = 0
  private queue: VoiceIdentity[] = []
  private active: VoiceIdentity | null = null
  private audio: HTMLAudioElement | null = null
  private request: { abort?: () => void } | null = null
  private ownsPause = false
  private resumeSuppressed = false
  private previousTime: number
  private started: boolean
  private timer: ReturnType<typeof setTimeout> | null = null
  private remaining = 0
  private deadline = 0

  constructor(video: HTMLVideoElement, loadUrl: VoiceInterjectionController['loadUrl']) {
    this.video = video
    this.loadUrl = loadUrl
    this.previousTime = video.currentTime
    this.started = video.currentTime > 0
  }

  getSnapshot = (): VoicePlaybackSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<VoicePlaybackSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private canonical(identity: VoiceIdentity): Annotation | undefined {
    return this.notes.find((note) => note.id === identity.id
      && note.voice?.asset_id === identity.assetId && note.voice.audio_status === 'ready')
  }

  update(notes: readonly Annotation[], enabled: boolean): void {
    this.notes = notes
    const wasEnabled = this.enabled
    this.enabled = enabled
    if (!enabled) {
      if (this.active || this.queue.length) this.finish(true)
      else if (this.snapshot.hint) this.publish({ hint: null, state: 'idle' })
      return
    }
    if (!wasEnabled) {
      this.previousTime = this.video.currentTime
      this.started = this.video.currentTime > 0
    }
    this.queue = this.queue.filter((identity) => this.canonical(identity))
    if (this.active) {
      const current = this.canonical(this.active)
      if (!current) this.finish(true)
      else if (JSON.stringify(current) !== JSON.stringify(this.snapshot.current)) this.publish({ current })
    }
    if (this.snapshot.hint && !notes.some((note) => note.id === this.snapshot.hint!.id
      && note.voice?.audio_status === 'ready')) this.publish({ hint: null, state: 'idle' })
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private clearAudio(): void {
    if (!this.audio) return
    this.audio.onended = null
    this.audio.onerror = null
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.audio = null
  }

  private finish(resume: boolean, error: string | null = null): void {
    this.generation++
    this.clearTimer()
    this.request?.abort?.()
    this.request = null
    this.clearAudio()
    const shouldResume = resume && this.ownsPause && !this.resumeSuppressed && this.connected && !this.video.seeking
    this.ownsPause = false
    this.resumeSuppressed = false
    this.active = null
    this.queue = []
    this.remaining = 0
    this.publish({ state: 'idle', current: null, hint: null, error })
    if (shouldResume) void this.video.play().catch(() => undefined)
  }

  private fail = (): void => { this.finish(true, 'Could not play voice commentary. Play the video to continue.') }

  private arm(milliseconds: number, generation: number, onTimeout: () => void): void {
    this.clearTimer()
    this.deadline = Date.now() + milliseconds
    this.timer = setTimeout(() => {
      if (this.connected && generation === this.generation) onTimeout()
    }, Math.max(0, milliseconds))
  }

  private async playNext(): Promise<void> {
    this.clearTimer()
    this.clearAudio()
    let note: Annotation | undefined
    while (this.queue.length && !note) note = this.canonical(this.queue.shift()!)
    if (!note) { this.finish(true); return }
    this.active = { id: note.id, assetId: note.voice!.asset_id }
    const generation = ++this.generation
    this.publish({ state: 'loading', current: note, hint: null, error: null })
    this.arm(15_000, generation, this.fail)
    try {
      const request = this.loadUrl(note.id)
      this.request = request
      const response = await request.unwrap()
      if (!this.connected || generation !== this.generation) return
      this.request = null
      const audio = new Audio(response.audio.url)
      this.audio = audio
      audio.onended = () => {
        if (generation === this.generation && this.connected) void this.playNext()
      }
      audio.onerror = () => {
        if (generation === this.generation && this.connected) this.fail()
      }
      await audio.play()
      if (!this.connected || generation !== this.generation) { audio.pause(); return }
      this.remaining = Math.max(0.001, note.duration_seconds) * 1000 + 3000
      this.publish({ state: 'playing' })
      this.arm(this.remaining, generation, this.fail)
    } catch {
      if (this.connected && generation === this.generation) this.fail()
    }
  }

  private onPlay = (): void => {
    if (this.active) {
      this.resumeSuppressed = true
      this.video.pause()
      return
    }
    this.previousTime = this.video.currentTime
    this.started = this.video.currentTime > 0
  }

  private onSeeking = (): void => {
    // Seeking never starts the video, including during a loading or paused note.
    // With nothing active there's nothing to cancel, and finish() would also
    // wipe the "commentary ahead" hint the timeupdate just computed for the
    // new position (the paused-seek `seeked` event arrives after it).
    if (this.active || this.queue.length || this.request) this.finish(false)
    this.previousTime = this.video.currentTime
    this.started = true
  }

  private onTime = (): void => {
    const now = this.video.currentTime
    if (!this.enabled || this.active) {
      this.previousTime = now
      return
    }
    const playable = this.notes.filter((note) => note.voice?.audio_status === 'ready')
    // A paused or seeking video never starts a note, but the "commentary
    // ahead" hint still tracks the playhead (seeking while paused updates it).
    const crossed = this.video.seeking || this.video.paused
      ? []
      : crossedNotes(playable, this.previousTime, now, this.started)
    this.previousTime = now
    this.started = true
    if (crossed.length) {
      this.queue = crossed.map((note) => ({ id: note.id, assetId: note.voice!.asset_id }))
      this.ownsPause = !this.video.paused
      this.resumeSuppressed = false
      this.video.pause()
      void this.playNext()
    } else {
      const hint = playable.find((note) => note.start_seconds > now && note.start_seconds <= now + 3) ?? null
      if (hint !== this.snapshot.hint) this.publish({ hint, state: hint ? 'hinting' : 'idle' })
    }
  }

  private onKey = (event: KeyboardEvent): void => {
    // Leave the browser's fullscreen exit behavior intact.
    if (event.key === 'Escape' && this.active) this.skip()
  }

  connect(): () => void {
    this.connected = true
    this.video.addEventListener('play', this.onPlay)
    this.video.addEventListener('seeking', this.onSeeking)
    this.video.addEventListener('seeked', this.onSeeking)
    this.video.addEventListener('timeupdate', this.onTime)
    window.addEventListener('keydown', this.onKey)
    return () => {
      this.connected = false
      this.video.removeEventListener('play', this.onPlay)
      this.video.removeEventListener('seeking', this.onSeeking)
      this.video.removeEventListener('seeked', this.onSeeking)
      this.video.removeEventListener('timeupdate', this.onTime)
      window.removeEventListener('keydown', this.onKey)
      this.finish(false)
    }
  }

  skip = (): void => { if (this.active) this.finish(true) }

  pauseCommentary = (): void => {
    if (!this.audio || this.snapshot.state !== 'playing') return
    this.remaining = Math.max(0, this.deadline - Date.now())
    this.clearTimer()
    this.resumeSuppressed = true
    this.audio.pause()
    this.publish({ state: 'paused' })
  }

  resumeCommentary = async (): Promise<void> => {
    const audio = this.audio
    if (!audio || this.snapshot.state !== 'paused') return
    const generation = ++this.generation
    audio.onended = () => { if (this.connected && generation === this.generation) void this.playNext() }
    audio.onerror = () => { if (this.connected && generation === this.generation) this.fail() }
    this.publish({ state: 'loading' })
    this.arm(15_000, generation, this.fail)
    try {
      await audio.play()
      if (!this.connected || generation !== this.generation) { audio.pause(); return }
      this.publish({ state: 'playing' })
      this.arm(this.remaining, generation, this.fail)
    } catch {
      if (this.connected && generation === this.generation) this.fail()
    }
  }
}
