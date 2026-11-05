import { act } from '@testing-library/react'
import { vi } from 'vitest'

export class FakeAudio {
  static instances: FakeAudio[] = []
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  paused = true
  play = vi.fn(async () => {
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  removeAttribute = vi.fn()
  load = vi.fn()
  src: string
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
}

export function playableVideo() {
  const video = document.createElement('video')
  let paused = false
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused })
  video.pause = vi.fn(() => {
    paused = true
  })
  video.play = vi.fn(async () => {
    paused = false
  })
  const dispatch = video.dispatchEvent.bind(video)
  video.dispatchEvent = (event: Event) => {
    if (event.type === 'play') paused = false
    return dispatch(event)
  }
  video.currentTime = 0
  return video
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export function tick(video: HTMLVideoElement, now = 1) {
  act(() => {
    video.dispatchEvent(new Event('play'))
    video.currentTime = now
    video.dispatchEvent(new Event('timeupdate'))
  })
}
