import { expect, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_URL, APP_URL, VOICE } from './fixtures.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const VOICE_FIXTURE_BYTES = readFileSync(path.join(repoRoot, VOICE.fixturePathFromRepoRoot))

export function resetVoiceFixtures(): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'speechcoach-e2e',
      '-f',
      'compose.yaml',
      '-f',
      'compose.e2e.yaml',
      'exec',
      '-T',
      'app',
      'php',
      'artisan',
      'db:seed',
      '--class=Database\\Seeders\\E2EVoiceAnnotationSeeder',
      '--force',
    ],
    { cwd: repoRoot, stdio: 'ignore' },
  )
}

/**
 * A browser-local media seam, not an application/API mock. Both preferred
 * MIME types claim support; the first recorder is successfully constructed
 * and then throws from start(), while the second emits the committed M4A.
 * This pins the Safari failure mode that motivated construct-and-catch.
 */
export async function installDeterministicRecorder(page: Page): Promise<void> {
  const fixtureBase64 = VOICE_FIXTURE_BYTES.toString('base64')
  const script = `
    (() => {
      const fixtureBase64 = ${JSON.stringify(fixtureBase64)};
      const bytes = Uint8Array.from(atob(fixtureBase64), (char) => char.charCodeAt(0));
      const attempts = [];
      Object.defineProperty(globalThis, '__voiceRecorderAttempts', { value: attempts, configurable: true });

      class DeterministicRecorder extends EventTarget {
        static isTypeSupported(type) {
          return type === 'audio/webm;codecs=opus' || type === 'audio/mp4;codecs=mp4a.40.2';
        }
        constructor(_stream, options = {}) {
          super();
          this.mimeType = options.mimeType || 'audio/mp4';
          this.state = 'inactive';
          attempts.push({ phase: 'construct', mimeType: this.mimeType });
        }
        start() {
          attempts.push({ phase: 'start', mimeType: this.mimeType });
          if (this.mimeType === 'audio/webm;codecs=opus') {
            throw new DOMException('forced first-preference failure', 'NotSupportedError');
          }
          this.state = 'recording';
        }
        stop() {
          if (this.state !== 'recording') return;
          const blob = new Blob([bytes], { type: this.mimeType });
          const data = new Event('dataavailable');
          Object.defineProperty(data, 'data', { value: blob });
          this.dispatchEvent(data);
          this.state = 'inactive';
          this.dispatchEvent(new Event('stop'));
        }
      }

      const track = { stop() { this.stopped = true; }, stopped: false };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
      });
      Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: DeterministicRecorder });
    })();
  `
  await page.addInitScript({ content: script })
}

export type DeterministicAudioMode = 'natural' | 'hold' | 'reject'

/**
 * Narrow `new Audio(url)` seam for the interjection controller. It still
 * performs a real Range fetch against the backend-issued signed URL before
 * resolving play(); only the media clock/ended/rejection outcome is made
 * deterministic. This is controller evidence, not codec/autoplay evidence.
 */
export async function installDeterministicVoiceAudio(
  page: Page,
  initialMode: DeterministicAudioMode = 'natural',
): Promise<void> {
  const script = `
    (() => {
      let mode = ${JSON.stringify(initialMode)};
      let current = null;
      const events = [];
      Object.defineProperty(globalThis, '__voiceAudioEvents', { value: events, configurable: true });
      Object.defineProperty(globalThis, '__setVoiceAudioMode', { configurable: true, value: (next) => { mode = next; } });
      Object.defineProperty(globalThis, '__finishVoiceAudio', {
        configurable: true,
        value: () => { if (current && typeof current.onended === 'function') current.onended(new Event('ended')); },
      });

      class DeterministicAudio {
        constructor(src) {
          this.src = src;
          this.paused = true;
          this.onended = null;
          this.onerror = null;
          current = this;
          events.push({ phase: 'construct', src });
        }
        async play() {
          events.push({ phase: 'play', mode });
          if (mode === 'reject') throw new DOMException('forced autoplay rejection', 'NotAllowedError');
          const response = await fetch(this.src, { headers: { Range: 'bytes=0-31' } });
          events.push({ phase: 'range', status: response.status, bytes: (await response.arrayBuffer()).byteLength });
          if (response.status !== 206) throw new Error('signed audio Range request did not return 206');
          this.paused = false;
          if (mode === 'natural') {
            setTimeout(() => {
              this.paused = true;
              if (typeof this.onended === 'function') this.onended(new Event('ended'));
            }, 800);
          }
        }
        pause() { this.paused = true; events.push({ phase: 'pause' }); }
        removeAttribute(name) { if (name === 'src') this.src = ''; }
        load() {}
      }

      Object.defineProperty(globalThis, 'Audio', { configurable: true, value: DeterministicAudio });
    })();
  `
  await page.addInitScript({ content: script })
}

export async function setDeterministicAudioMode(page: Page, mode: DeterministicAudioMode): Promise<void> {
  await page.evaluate((nextMode) => {
    const state = globalThis as typeof globalThis & { __setVoiceAudioMode?: (next: string) => void }
    state.__setVoiceAudioMode?.(nextMode)
  }, mode)
}

export async function finishDeterministicAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & { __finishVoiceAudio?: () => void }
    state.__finishVoiceAudio?.()
  })
}

export async function deterministicAudioEvents(
  page: Page,
): Promise<Array<{ phase: string; status?: number; bytes?: number; mode?: string; src?: string }>> {
  return page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __voiceAudioEvents?: Array<{ phase: string; status?: number; bytes?: number; mode?: string; src?: string }>
    }
    return state.__voiceAudioEvents ?? []
  })
}

export async function recorderAttempts(page: Page): Promise<Array<{ phase: string; mimeType: string }>> {
  return page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __voiceRecorderAttempts?: Array<{ phase: string; mimeType: string }>
    }
    return state.__voiceRecorderAttempts ?? []
  })
}

export async function xsrfHeader(context: BrowserContext): Promise<Record<string, string>> {
  const cookie = (await context.cookies(API_URL)).find((candidate) => candidate.name === 'XSRF-TOKEN')
  expect(cookie, 'no XSRF-TOKEN cookie — has the seeded session gone stale?').toBeTruthy()
  return { 'X-XSRF-TOKEN': decodeURIComponent(cookie!.value) }
}

export async function openSpeech(page: Page, speechId: number): Promise<void> {
  await page.goto(`${APP_URL}/speeches/${speechId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await expect(page.getByTestId('speech-video')).toBeVisible({ timeout: 30_000 })
}
