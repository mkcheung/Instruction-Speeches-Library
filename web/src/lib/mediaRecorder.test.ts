import { describe, expect, it, vi } from 'vitest'
import { startMediaRecorderWithFallback, VOICE_RECORDING_MIME_PREFERENCES } from '@/lib/mediaRecorder'

class FakeRecorder extends EventTarget {
  static isTypeSupported = vi.fn(() => true)
  static attempts: string[] = []
  mimeType: string
  state = 'inactive'
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType ?? ''
    FakeRecorder.attempts.push(this.mimeType)
    if (this.mimeType === VOICE_RECORDING_MIME_PREFERENCES[0]) throw new Error('constructor failed')
  }
  start() {
    if (this.mimeType === VOICE_RECORDING_MIME_PREFERENCES[1]) throw new Error('start failed')
    this.state = 'recording'
  }
}

const callbacks = {
  onDataAvailable: vi.fn(),
  onStop: vi.fn(),
  onError: vi.fn(),
}

describe('startMediaRecorderWithFallback', () => {
  it('falls through both a constructor failure and a start failure', () => {
    FakeRecorder.attempts = []
    const result = startMediaRecorderWithFallback(
      {} as MediaStream,
      callbacks,
      FakeRecorder as unknown as typeof MediaRecorder,
    )

    expect(FakeRecorder.attempts.slice(0, 3)).toEqual(VOICE_RECORDING_MIME_PREFERENCES.slice(0, 3))
    expect(result?.mimeType).toBe(VOICE_RECORDING_MIME_PREFERENCES[2])
  })

  it('treats isTypeSupported as a filter and tries the browser default last', () => {
    class DefaultOnlyRecorder extends EventTarget {
      static isTypeSupported = vi.fn(() => false)
      mimeType = ''
      start = vi.fn()
    }
    const result = startMediaRecorderWithFallback(
      {} as MediaStream,
      callbacks,
      DefaultOnlyRecorder as unknown as typeof MediaRecorder,
    )
    expect(DefaultOnlyRecorder.isTypeSupported).toHaveBeenCalledTimes(VOICE_RECORDING_MIME_PREFERENCES.length)
    expect(result?.mimeType).toBe('application/octet-stream')
  })

  it('returns null when every construct/start attempt fails', () => {
    class BrokenRecorder extends EventTarget {
      static isTypeSupported = () => true
      constructor() {
        super()
        throw new Error('no recorder')
      }
    }
    expect(
      startMediaRecorderWithFallback({} as MediaStream, callbacks, BrokenRecorder as unknown as typeof MediaRecorder),
    ).toBeNull()
  })

  it('returns null when MediaRecorder is unavailable', () => {
    expect(startMediaRecorderWithFallback({} as MediaStream, callbacks, undefined)).toBeNull()
  })
})
