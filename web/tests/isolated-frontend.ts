import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Request } from '@playwright/test'
import { API_URL, APP_URL } from './fixtures.js'
import { notebookMediaResponse, notebookResponse, notebookReview, notebookSpeech, type NotebookFixtureOptions } from './notebook-fixtures.js'

export type IsolatedJson = (body: unknown, status?: number) => Promise<void>

export interface IsolatedFallback {
  request: Request
  url: URL
  json: IsolatedJson
  /** The current sign-in state (POST /login sets it; a draggable 401 clears it). */
  authenticated: boolean
  unexpected: string[]
}

export interface IsolatedFrontendOptions {
  notebook?: NotebookFixtureOptions
  initiallyAuthenticated: boolean
  /** The `user` that `POST /login` returns. */
  loginUser: unknown
  /** When set, logs `requestfailed` and `pageerror` as `[<label>/requestfailed]` and `[<label>/pageerror]`. */
  logLabel?: string
  /** Each spec's own answers for API requests the shared skeleton left unanswered. */
  fallback: (request: IsolatedFallback) => Promise<void>
}

/** Serves the built app and mocks every request; nothing reaches a server when WORKSPACE_USE_BUILT_ASSETS=1. */
export async function routeIsolatedFrontend(context: BrowserContext, options: IsolatedFrontendOptions): Promise<{ loginBodies: unknown[]; unexpected: string[] }> {
  // Optional delivery of the exact current build avoids Vite cold-module
  // failures without starting a server or manufacturing product markup.
  const builtRoot = process.env.WORKSPACE_USE_BUILT_ASSETS === '1'
    ? await realpath(fileURLToPath(new URL('../dist/', import.meta.url)))
    : null
  context.setDefaultNavigationTimeout(120_000)
  if (options.logLabel) {
    context.on('requestfailed', (request) => console.log(`[${options.logLabel}/requestfailed]`, request.url(), request.failure()?.errorText))
    context.on('page', (page) => page.on('pageerror', (error) => console.log(`[${options.logLabel}/pageerror]`, error.message)))
  }
  let authenticated = options.initiallyAuthenticated
  const loginBodies: unknown[] = []
  const unexpected: string[] = []
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // WebKit routes native Blob URL reads (captions/cropper) through this
    // callback. Permit only this page origin's exact browser-memory UUIDs;
    // HTTP UUID paths and foreign Blob origins retain fail-closed handling.
    const blobPrefix = `blob:${new URL(APP_URL).origin}/`
    if (request.url().startsWith(blobPrefix)
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.url().slice(blobPrefix.length))) {
      return route.continue()
    }
    if (options.notebook && url.origin === new URL(APP_URL).origin && ['/__notebook/speech.mp4', '/__notebook/voice.m4a'].includes(url.pathname)) {
      if (options.notebook.draggable && url.pathname === '/__notebook/voice.m4a' && options.notebook.scrubWire) options.notebook.scrubWire.voiceMediaRequests += 1
      return notebookMediaResponse(route, options.notebook)
    }
    if (url.origin === new URL(APP_URL).origin) {
      if (!builtRoot) return route.continue()
      // Fail closed for non-GET requests and for traversal, symlinks outside
      // dist, directories, or missing build assets. Documents always use the
      // build's own index.html so the real frontend router handles the URL.
      if (!['GET', 'HEAD'].includes(request.method())) {
        unexpected.push(`${request.method()} ${url.pathname}`)
        return route.abort('blockedbyclient')
      }
      try {
        const candidate = resolve(builtRoot, request.isNavigationRequest()
          ? 'index.html'
          : '.' + decodeURIComponent(url.pathname))
        if (!candidate.startsWith(builtRoot + sep)) throw new Error('Path outside build root')
        const canonical = await realpath(candidate)
        if (!canonical.startsWith(builtRoot + sep) || !(await stat(canonical)).isFile()) {
          throw new Error('Not a bounded build file')
        }
        const mime: Record<string, string> = {
          '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
          '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
        }
        return route.fulfill({ status: 200, body: await readFile(canonical), headers: {
          'content-type': mime[extname(canonical)] ?? 'application/octet-stream', 'cache-control': 'no-store',
        } })
      } catch {
        unexpected.push(`Missing or unsafe build asset: ${url.pathname}`)
        return route.abort('blockedbyclient')
      }
    }
    // Fail closed: no API, media, or unexpected external request reaches a server.
    if (url.origin !== new URL(API_URL).origin) {
      unexpected.push(request.url())
      return route.abort('blockedbyclient')
    }
    const headers = { 'access-control-allow-origin': APP_URL, 'access-control-allow-credentials': 'true' }
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body })
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS', 'access-control-allow-headers': 'content-type, x-xsrf-token, accept' } })
    }
    if (url.pathname === '/sanctum/csrf-cookie') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/login' && request.method() === 'POST') {
      loginBodies.push(request.postDataJSON())
      authenticated = true
      return json({ user: options.loginUser })
    }
    if (options.notebook) {
      if (options.notebook.draggable && options.notebook.scrubWire) {
        const wire = options.notebook.scrubWire
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) wire.mutations.push(`${request.method()} ${url.pathname}`)
        if (request.method() === 'GET' && url.pathname === '/api/reviews') {
          wire.reviewRequests += 1
          const status = await wire.reviewReply?.(wire.reviewRequests) ?? 200
          // Real ReviewResource list rows omit reviewer, including reviewer.id.
          const review = Object.fromEntries(Object.entries(notebookReview(options.notebook)).filter(([key]) => key !== 'reviewer'))
          return json(status === 200 ? { invited: [], in_progress: [review], published: [], revoked: [] }
            : { message: 'Isolated review validation failure.' }, status)
        }
        if (request.method() === 'GET' && url.pathname === '/api/speeches/9/assets/90/playback-url') {
          wire.playbackRequests += 1
          await wire.playbackReply?.(wire.playbackRequests)
        }
      }
      if (options.notebook.ownerVideoTools && url.pathname === '/api/speeches/9/assets/90/poster-frame' && request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>
        if (Object.keys(body).length !== 1 || typeof body.time_seconds !== 'number' || !Number.isFinite(body.time_seconds) || body.time_seconds < 0 || body.time_seconds > 3) {
          unexpected.push(`Invalid poster body: ${request.postData()}`)
          return json({ message: 'Invalid isolated poster request.' }, 422)
        }
        options.notebook.ownerWire?.posterRequests.push({ path: url.pathname, body: { time_seconds: body.time_seconds } })
        const status = await options.notebook.ownerWire?.posterReply?.() ?? 200
        if (options.notebook.draggable && status === 401) authenticated = false
        return json(status === 200 ? { asset: { ...notebookSpeech(options.notebook).primary_video, poster_time_seconds: body.time_seconds } }
          : { message: 'Isolated poster failure.' }, status)
      }
      if (options.notebook.ownerVideoTools && /^\/api\/speeches\/9\/annotations\/owner-[ab]-voice\/voice-playback-url$/.test(url.pathname)) await options.notebook.ownerWire?.voiceReply?.()
      const response = notebookResponse(url, request.method(), options.notebook, request.method() === 'PATCH' ? request.postDataJSON() as Record<string, unknown> : undefined)
      if (response) return json(response.body, response.status ?? 200)
    }
    return options.fallback({ request, url, json, authenticated, unexpected })
  })
  return { loginBodies, unexpected }
}
