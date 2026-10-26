import type { CommentaryPlaybackMode, CommentaryPlaybackPreference } from '@/features/annotation/types'
import { isCommentaryPlaybackMode } from '@/lib/commentaryPlayback'
import { isTerminalAccessError } from '@/lib/errorStatus'

export interface PlaybackPreferenceTransport {
  read: () => Promise<CommentaryPlaybackPreference>
  write: (mode: CommentaryPlaybackMode) => Promise<CommentaryPlaybackPreference>
  cancel: () => void
  confirmed: (preference: CommentaryPlaybackPreference) => void
}

export interface PlaybackPreferenceState {
  mode: CommentaryPlaybackMode
  ready: boolean
  loading: boolean
  saving: boolean
  loadError: boolean
  saveError: boolean
  accessDenied: boolean
  preference: CommentaryPlaybackPreference | null
}

export const SUPPRESSED_PLAYBACK_PREFERENCE: PlaybackPreferenceState = {
  mode: 'off', ready: false, loading: true, saving: false,
  loadError: false, saveError: false, accessDenied: false, preference: null,
}

/** One coordinator per identity/speech, independent of component mount lifetime.
 * It owns the displayed state; raw RTK cache data never replaces an intent. */
export class PlaybackPreferenceCoordinator {
  private state: PlaybackPreferenceState = SUPPRESSED_PLAYBACK_PREFERENCE
  private listeners = new Set<() => void>()
  private active = true
  private readGeneration = 0
  private intentGeneration = 0
  private reading = false
  private writing = false
  private desired: { mode: CommentaryPlaybackMode; generation: number } | null = null
  private speechId: number
  private transport: PlaybackPreferenceTransport

  constructor(speechId: number, transport: PlaybackPreferenceTransport) {
    this.speechId = speechId
    this.transport = transport
  }

  getSnapshot = (): PlaybackPreferenceState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<PlaybackPreferenceState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private validate(value: CommentaryPlaybackPreference): CommentaryPlaybackPreference {
    if (!value || value.speech_id !== this.speechId || !isCommentaryPlaybackMode(value.mode)
      || !['saved', 'legacy', 'default', 'invalid'].includes(value.source)) {
      throw new Error('Invalid commentary playback preference response')
    }
    return value
  }

  private denyAccess(): void {
    this.desired = null
    this.readGeneration++
    this.publish({
      mode: 'off', ready: false, loading: false, saving: false,
      accessDenied: true, loadError: true, saveError: false, preference: null,
    })
  }

  hydrate = async (): Promise<void> => {
    // A pending/unsaved session choice must survive remount and window focus.
    if (!this.active || this.writing || this.desired || this.reading) return
    this.reading = true
    const readGeneration = ++this.readGeneration
    const intentGeneration = this.intentGeneration
    this.publish({ loading: !this.state.ready, loadError: false })
    try {
      const preference = this.validate(await this.transport.read())
      if (!this.active || readGeneration !== this.readGeneration || intentGeneration !== this.intentGeneration) return
      this.transport.confirmed(preference)
      this.publish({ preference, mode: preference.mode, ready: true, loading: false, accessDenied: false })
    } catch (error) {
      if (!this.active || readGeneration !== this.readGeneration || intentGeneration !== this.intentGeneration) return
      if (isTerminalAccessError(error)) this.denyAccess()
      else this.publish({ loading: false, loadError: true })
    } finally {
      this.reading = false
    }
  }

  select = (mode: CommentaryPlaybackMode): void => {
    if (!this.active || !this.state.ready || !isCommentaryPlaybackMode(mode)) return
    this.desired = { mode, generation: ++this.intentGeneration }
    this.readGeneration++
    this.publish({ mode, loading: false, loadError: false, saveError: false, saving: true })
    void this.drain()
  }

  retry = (): void => {
    if (this.desired) {
      this.publish({ saveError: false, saving: true })
      void this.drain()
    } else {
      void this.hydrate()
    }
  }

  private async drain(): Promise<void> {
    if (!this.active || this.writing || !this.desired) return
    this.writing = true
    try {
      while (this.active && this.desired) {
        const sent: { mode: CommentaryPlaybackMode; generation: number } = this.desired
        try {
          const preference = this.validate(await this.transport.write(sent.mode))
          if (!this.active) return
          if (preference.mode !== sent.mode || preference.source !== 'saved') {
            throw new Error('Preference acknowledgement did not match the saved choice')
          }
          // Commit before dropping the override; no render can fall back to a stale GET.
          this.transport.confirmed(preference)
          if (this.desired?.generation === sent.generation) {
            this.desired = null
            this.publish({ preference, mode: preference.mode, saving: false, saveError: false })
          } else {
            this.publish({ preference })
          }
        } catch (error) {
          if (!this.active) return
          if (isTerminalAccessError(error)) {
            this.denyAccess()
            return
          }
          if (this.desired?.generation === sent.generation) {
            // Keep the override in this tab, but never persist a failed choice as confirmed.
            this.publish({ saving: false, saveError: true })
            return
          }
          // A superseded transient failure must not discard the newer queued intent.
        }
      }
    } finally {
      this.writing = false
    }
  }

  dispose(): void {
    this.active = false
    this.desired = null
    this.readGeneration++
    this.transport.cancel()
    this.publish({ ...SUPPRESSED_PLAYBACK_PREFERENCE, loading: false })
  }
}

/** The registry lives for one authenticated identity, including across routes. */
export class PlaybackPreferenceRegistry {
  private userId: string | null = null
  private entries = new Map<number, PlaybackPreferenceCoordinator>()

  setIdentity(userId: string | null): void {
    if (userId === this.userId) return
    this.entries.forEach((entry) => entry.dispose())
    this.entries.clear()
    this.userId = userId
  }

  get(userId: string, speechId: number, transport: () => PlaybackPreferenceTransport): PlaybackPreferenceCoordinator {
    this.setIdentity(userId)
    let entry = this.entries.get(speechId)
    if (!entry) {
      entry = new PlaybackPreferenceCoordinator(speechId, transport())
      this.entries.set(speechId, entry)
    }
    return entry
  }
}

export const playbackPreferences = new PlaybackPreferenceRegistry()

export function playbackPreferenceCacheKey(userId: string, speechId: number): string {
  return `commentary-playback:v1:${userId}:${speechId}`
}
