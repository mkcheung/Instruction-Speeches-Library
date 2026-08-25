export const VOICE_RECORDING_MIME_PREFERENCES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const

export interface RecorderCallbacks {
  onDataAvailable: (event: BlobEvent) => void
  onStop: () => void
  onError: (event: Event) => void
}

export interface StartedMediaRecorder {
  recorder: MediaRecorder
  mimeType: string
}

/**
 * `isTypeSupported()` is only a filter. Some Safari/iOS versions have
 * returned true and then thrown from either construction or `start()`, so
 * both operations live inside the preference-loop's try/catch.
 */
export function startMediaRecorderWithFallback(
  stream: MediaStream,
  callbacks: RecorderCallbacks,
  Recorder: typeof MediaRecorder | undefined = globalThis.MediaRecorder,
): StartedMediaRecorder | null {
  if (!Recorder) return null

  const candidates: Array<string | undefined> = [...VOICE_RECORDING_MIME_PREFERENCES, undefined]
  for (const mimeType of candidates) {
    if (mimeType) {
      try {
        if (!Recorder.isTypeSupported(mimeType)) continue
      } catch {
        continue
      }
    }

    let recorder: MediaRecorder | null = null
    try {
      recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream)
      recorder.addEventListener('dataavailable', callbacks.onDataAvailable)
      recorder.addEventListener('stop', callbacks.onStop)
      recorder.addEventListener('error', callbacks.onError)
      recorder.start(250)
      return { recorder, mimeType: recorder.mimeType || mimeType || 'application/octet-stream' }
    } catch {
      if (recorder) {
        recorder.removeEventListener('dataavailable', callbacks.onDataAvailable)
        recorder.removeEventListener('stop', callbacks.onStop)
        recorder.removeEventListener('error', callbacks.onError)
      }
    }
  }

  return null
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}
