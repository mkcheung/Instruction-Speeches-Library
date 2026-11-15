import type { Annotation, VoiceAudioUrlResponse } from '@/features/annotation/types'
import {
  CUE_TOLERANCE_SECONDS, PLAYHEAD_TOLERANCE_SECONDS, VOICE_NOTE_SEEK_EPSILON_SECONDS, comparePlaybackOrder, crossedNotes,
} from '@/lib/crossedNotes'

type VoiceIdentity = { id: string; assetId: number }
export type VoicePlaybackState = 'idle' | 'hinting' | 'loading' | 'playing' | 'paused'
export type VoicePlaybackSource = 'crossing' | 'list'
export interface VoicePlaybackSnapshot {
  state: VoicePlaybackState
  current: Annotation | null
  hint: Annotation | null
  error: string | null
  source: VoicePlaybackSource | null
}
export const IDLE_VOICE_PLAYBACK: VoicePlaybackSnapshot = { state: 'idle', current: null, hint: null, error: null, source: null }

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
  /** onPlay's raised lower bound; held until playback passes it or a seek/re-enable resets the playhead. */
  private playFloor: number | null = null
  private cue: (VoiceIdentity & { seconds: number }) | null = null
  private source: VoicePlaybackSource = 'crossing'
  private resumeFloor: number | null = null
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
    // A cue follows its note's id, asset and start: a removed, replaced or re-timed note drops it.
    const cue = this.cue
    if (cue && (!enabled || this.canonical(cue)?.start_seconds !== cue.seconds)) this.cue = null
    const cueDropped = cue !== null && this.cue === null
    if (!enabled) {
      if (this.active || this.queue.length) this.finish(true)
      // Drop a stale error too, or re-enabling would show it again.
      else if (this.snapshot.hint || this.snapshot.error) this.publish({ hint: null, error: null, state: 'idle' })
      return
    }
    if (!wasEnabled) {
      this.playFloor = null
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
    // The dropped cue's "Commentary ahead" goes with it (a replaced asset keeps the id, so the check above misses it).
    if (cueDropped && !this.active) this.refreshHint()
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
    const hint = this.cueHint(this.video.currentTime)
    this.publish({ state: hint ? 'hinting' : 'idle', current: null, hint, error, source: null })
    if (shouldResume) void this.video.play().catch(() => undefined)
  }

  private fail = (): void => {
    this.finish(true, this.source === 'list' ? 'Could not play this voice commentary.'
      : 'Could not play voice commentary. Play the video to continue.')
  }

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
    this.publish({ state: 'loading', current: note, hint: null, error: null, source: this.source })
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
    // The video's own Play (its button, a click on the video, Space) cancels any note, whether
    // loading, playing or paused, and any armed note. The video carries on from the playhead.
    if (this.busy) {
      this.cue = null
      this.finish(false)
    }
    if (this.startCue()) return
    const now = this.video.currentTime
    // Notes an armed run already played at this position never replay on the next Play,
    // whoever presses it. Only a new seek (`seeking`) discards the floor.
    const floor = this.resumeFloor
    this.resumeFloor = null
    const floorBase = floor !== null ? Math.max(now, floor) : now
    this.playFloor = (floorBase > 0 || floor !== null) && !this.cue ? floorBase + PLAYHEAD_TOLERANCE_SECONDS : null
    this.previousTime = this.playFloor ?? now
    this.started = now > 0 || floor !== null
  }

  private onSeeking = (event: Event): void => {
    if (event.type === 'seeking') {
      // Seeking never starts the video, including during a loading or paused note.
      if (this.busy) this.finish(false)
      // While seeking, currentTime reports the latest target: any other seek drops the cue.
      if (this.cue && Math.abs(this.video.currentTime - this.cue.seconds) > CUE_TOLERANCE_SECONDS) this.cue = null
      this.resumeFloor = null
    }
    this.playFloor = null
    this.previousTime = this.video.currentTime
    this.started = true
  }

  private onTime = (): void => {
    const now = this.video.currentTime
    if (!this.enabled || this.active) {
      this.previousTime = now
      return
    }
    if (this.startCue()) return
    const playable = this.notes.filter((note) => note.voice?.audio_status === 'ready')
    // A paused or seeking video never starts a note, but the "commentary
    // ahead" hint still tracks the playhead (seeking while paused updates it).
    const crossed = this.video.seeking || this.video.paused
      ? []
      : crossedNotes(playable, this.previousTime, now, this.started)
    // A tick that has not yet moved past onPlay's raised value must not lower it again,
    // or the next tick would replay a note stamped inside that tolerance.
    if (this.playFloor !== null && now >= this.playFloor) this.playFloor = null
    this.previousTime = this.playFloor ?? now
    this.started = true
    if (crossed.length) this.begin(crossed, !this.video.paused, 'crossing')
    else this.refreshHint(now, playable)
  }

  /** The armed note while the playhead sits on it, else the next ready note within 3 s. */
  private refreshHint(now = this.video.currentTime,
    playable = this.notes.filter((note) => note.voice?.audio_status === 'ready')): void {
    // Same lower bound as the crossing: a note inside onPlay's tolerance is never announced.
    const hintFrom = this.playFloor ?? now
    const hint = this.cueHint(now) ?? playable.find((note) => note.start_seconds > hintFrom && note.start_seconds <= now + 3) ?? null
    if (hint !== this.snapshot.hint) this.publish({ hint, state: hint ? 'hinting' : 'idle' })
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
      this.cue = null
      this.finish(false)
    }
  }

  private get busy(): boolean {
    return this.active !== null || this.queue.length > 0 || this.request !== null
  }

  /** The canonical ready note behind a caller's object, while audio is on and the controller is connected. */
  private readyNote(note: Annotation): Annotation | undefined {
    return this.enabled && this.connected && note.voice
      ? this.canonical({ id: note.id, assetId: note.voice.asset_id }) : undefined
  }

  private begin(notes: readonly Annotation[], ownsPause: boolean, source: VoicePlaybackSource): void {
    this.queue = notes.map((note) => ({ id: note.id, assetId: note.voice!.asset_id }))
    this.ownsPause = ownsPause
    this.resumeSuppressed = !ownsPause
    this.source = source
    this.video.pause()
    void this.playNext()
  }

  private cueHint(now: number): Annotation | null {
    if (!this.enabled || !this.cue || Math.abs(now - this.cue.seconds) > CUE_TOLERANCE_SECONDS) return null
    return this.canonical(this.cue) ?? null
  }

  private startCue(): boolean {
    if (!this.cue || !this.enabled || this.active || this.video.paused || this.video.seeking) return false
    const cue = this.cue
    this.cue = null
    const chosen = this.canonical(cue)
    const now = this.video.currentTime
    if (!chosen || now < cue.seconds - CUE_TOLERANCE_SECONDS || now > cue.seconds + VOICE_NOTE_SEEK_EPSILON_SECONDS) return false
    const group = this.notes.filter((note) => note.voice?.audio_status === 'ready'
      && (note.start_seconds === chosen.start_seconds ? comparePlaybackOrder(note, chosen) >= 0
        : note.start_seconds > chosen.start_seconds && note.start_seconds <= now)).sort(comparePlaybackOrder)
    this.playFloor = null
    this.previousTime = now
    this.started = true
    this.resumeFloor = Math.max(...group.map((note) => note.start_seconds))
    this.begin(group, true, 'crossing')
    return true
  }

  armNote = (note: Annotation): void => {
    if (this.busy) this.finish(false)
    const chosen = this.readyNote(note)
    this.cue = chosen ? { id: chosen.id, assetId: chosen.voice!.asset_id, seconds: chosen.start_seconds } : null
    if (chosen) this.publish({ state: 'hinting', hint: chosen, error: null })
  }

  playNote = (note: Annotation): void => {
    const chosen = this.readyNote(note)
    if (!chosen) return
    if (this.active && this.active.id === chosen.id && this.active.assetId === chosen.voice!.asset_id) return
    if (this.busy) this.finish(false)
    if (this.cue?.id === chosen.id) this.cue = null
    this.begin([chosen], false, 'list')
  }

  /** Author intent (capture, delete, Clear all): the note and its queue may finish, but the video must not auto-resume. */
  suppressResume = (): void => {
    if (this.cue) {
      this.cue = null
      // Its "Commentary ahead" goes too: Play from here no longer plays it.
      if (!this.active) this.refreshHint()
    }
    if (this.active || this.queue.length) this.resumeSuppressed = true
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
