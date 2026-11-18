import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { APP_URL } from './fixtures.js'

// Test-local wire fixtures only. Every response follows the current API slice;
// unknown requests still fail closed in the surrounding interceptor.
export interface OwnerToolsWire {
  posterRequests: Array<{ path: string; body: { time_seconds: number } }>
  posterReply?: () => Promise<number>
  voiceReply?: () => Promise<void>
}
export interface ScrubWire {
  reviewRequests: number
  playbackRequests: number
  voiceMediaRequests: number
  mutations: string[]
  reviewReply?: (request: number) => Promise<number>
  playbackReply?: (request: number) => Promise<void>
}
export interface NotebookFixtureOptions {
  draggable?: boolean
  scrubWire?: ScrubWire
  noSelectedReview?: boolean
  // Strict owner-only wire contract; legacy presentation fixtures retain their existing behavior.
  ownerVideoTools?: boolean
  ownerVariant?: 'empty' | 'denied'
  ownerWire?: OwnerToolsWire
  reviewer?: boolean
  // Opt in to one consistent reviewer/speech/annotation identity; legacy dashboard fixtures stay unchanged.
  reviewerOverlay?: boolean
  // 13 saved mixed annotations (text + voice, erased/historical points, processing/failed
  // transcripts) for the review-22 reviewer, who is also a Coach so the Voice tool exists.
  notebookTools?: boolean
  missingCaptions?: boolean
  writtenBody?: string
  feedback?: boolean
  playbackMode?: 'all' | 'written' | 'voice' | 'off'
  notReady?: boolean
  portrait?: boolean
  mode?: 'ready' | 'empty' | 'error'
  media?: Buffer
  coachStatus?: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn'
}
export const notebookDate = '2026-10-01T12:00:00Z'
export const notebookTitle = 'Finding a clear voice ' + 'LongSpeechTitle'.repeat(12)
export function notebookUser(options: NotebookFixtureOptions) {
  return { id: options.reviewer ? '2' : '1', email: 'notebook@example.test', first_name: 'Morgan', last_name: 'Member',
    username: 'notebook-member', display_name: 'Morgan Member', roles: options.ownerVideoTools && options.reviewer ? ['coach', 'admin'] : options.notebookTools ? ['coach'] : [], email_verified: true,
    onboarding_completed: true, onboarding_step: 4, storage_bytes_used: 120_000, quota_bytes: 5_000_000, uploads_in_flight: 0 }
}
export function notebookSpeech(options: NotebookFixtureOptions) {
  return { id: 9, ulid: 'notebook-speech', user_id: 1, title: notebookTitle,
    description: 'A rehearsal about confidence, opening clearly and connecting with the audience.',
    delivered_on: null, change_note: null, created_at: notebookDate, captions_enabled: true,
    primary_video: { id: 90, kind: 'video', status: options.notReady ? 'processing' : 'ready', failure_code: null, duration_seconds: '3',
      width: options.portrait ? 360 : 640, height: options.portrait ? 640 : 360, poster_time_seconds: null },
    ...(options.ownerVideoTools ? { sprite: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=',
      columns: 5, rows: 2, frame_width: 800, frame_height: options.portrait ? 568 : 180, duration_seconds: '3' } } : {}) }
}
// Ids that own ready audio in the notebookTools set; only these may resolve a playback URL.
export const notebookToolsAudioIds = ['notebook-voice', 'tools-voice-historic', 'tools-voice-ready-2', 'tools-voice-ready-3']
// Chronological: 13 notes = pages of 6, 6 and 1. Text ranges never overlap points; 2.45-3.0 stays free for a live draft.
export function notebookToolsAnnotations() {
  const text = (id: string, start: number, end: number, body: string) => ({ id, timing_type: 'range', start_seconds: start,
    duration_seconds: Math.round((end - start) * 1000) / 1000, kind: 'observation', topic: null, body, lock_version: 1, client_uuid: id, voice: null })
  const voice = (id: string, start: number, body: string, status: { audio_status: string; transcript_status: string } | null, timing: 'point' | null = 'point') => ({
    id, timing_type: timing, start_seconds: start, duration_seconds: 4, kind: 'observation', topic: null, body, lock_version: 1, client_uuid: id,
    voice: status === null ? null : { asset_id: 100 + Math.round(start * 100), ...status, failure_code: status.transcript_status === 'failed' ? 'fixture_transcript_failed' : null } })
  const ready = { audio_status: 'ready', transcript_status: 'ready' }
  return [
    text('tools-text-01', 0, .2, 'Open with a steady breath before the first word.'),
    voice('tools-voice-processing', .22, '', { audio_status: 'ready', transcript_status: 'processing' }),
    text('tools-text-02', .25, .35, 'Slow down on this phrase.'),
    text('notebook-written', .4, .9, 'Pause briefly before the opening sentence. Give the audience a moment to settle, then begin with a warm and confident voice.'),
    voice('tools-voice-failed', .95, '', { audio_status: 'ready', transcript_status: 'failed' }),
    voice('tools-voice-erased', 1, 'This transcript survives the erased audio.', null),
    voice('notebook-voice', 1.2, 'Your opening sounds warm and confident.', ready),
    voice('tools-voice-historic', 1.4, 'Historical note recorded before timing types existed.', ready, null),
    text('tools-text-03', 1.5, 1.7, 'Let the story land before moving on.'),
    voice('tools-voice-ready-2', 1.8, 'This pause works well.', ready),
    text('tools-text-04', 1.9, 2, 'Good eye contact here.'),
    text('tools-text-05', 2.1, 2.2, 'Lift the pitch slightly to close the thought.'),
    voice('tools-voice-ready-3', 2.3, 'A strong, memorable finish.', ready),
  ]
}
export function notebookReview(options: NotebookFixtureOptions) {
  return { id: 22, status: 'in_progress', invitation_message: 'Please consider my opening.', allow_preview: false,
    prior_commentary_shared: false, invited_at: notebookDate, responded_at: notebookDate,
    first_published_at: options.feedback ? notebookDate : null, last_published_at: options.feedback ? notebookDate : null, last_transition_at: notebookDate, revoked_at: null, revocation_reason: null,
    speech: { id: 9, ulid: 'notebook-speech', title: notebookTitle, owner_name: 'Morgan Member' },
    reviewer: { id: options.reviewer ? 2 : 3, username: 'avery-reviewer', name: 'Avery Reviewer' } }
}
// Two published tracks have different row identities and timing, never draft-inclusive rows.
export function ownerToolsTracks(options: NotebookFixtureOptions) {
  const first = { ...notebookReview(options), status: 'published', first_published_at: notebookDate,
    last_published_at: notebookDate, annotations_count: options.ownerVariant === 'empty' ? 0 : 6,
    published_annotations_count: options.ownerVariant === 'empty' ? 0 : 6, revoked_by_is_self: false }
  return [first, { ...first, id: 23, last_published_at: '2026-09-30T12:00:00Z',
    reviewer: { id: 4, username: 'jamie-member', name: 'Jamie Member' } }]
}
export function ownerToolsRows(reviewId: number) {
  const prefix = reviewId === 22 ? 'owner-a' : 'owner-b', shift = reviewId === 22 ? 0 : .1
  const row = (id: string, start: number, duration: number, timing: 'point' | 'range', body: string, audio = false) => ({
    id: `${prefix}-${id}`, timing_type: timing, start_seconds: start, duration_seconds: duration,
    kind: 'observation', topic: null, body, lock_version: 1, client_uuid: `${prefix}-${id}`,
    voice: audio ? { asset_id: reviewId + 100, audio_status: 'ready', transcript_status: 'ready', failure_code: null } : null,
  })
  return [row('edge', 0, 0, 'point', 'Erased boundary transcript.'),
    row('text', .4 + shift, .5, 'range', `${prefix} published written feedback.`),
    row('erased', 1 + shift, 0, 'point', 'The transcript survives erased audio.'),
    row('voice', 1.2 + shift, 10, 'point', `${prefix} published voice transcript.`, true),
    row('late', 2.2 + shift, .3, 'range', `${prefix} final written feedback.`),
    row('end', 2.99, 0, 'point', 'Erased ending transcript.')]
}
export function ownerToolsResponse(url: URL, method: string, options: NotebookFixtureOptions): { body: unknown; status?: number } | undefined {
  if (!options.ownerVideoTools || method !== 'GET') return undefined
  const tracks = ownerToolsTracks(options)
  switch (url.pathname) {
    case '/api/speeches/9/reviews': return { body: { reviews: tracks } }
    case '/api/speeches/9/review-roster': return { body: { reviews: options.noSelectedReview ? [] : tracks } }
    case '/api/speeches/9/annotations': {
      const review = tracks.find((track) => String(track.id) === url.searchParams.get('review_id'))
      if (!review || [...url.searchParams.keys()].some((key) => key !== 'review_id')) return { status: 403, body: { message: 'Unexpected owner review denied.' } }
      if (options.ownerVariant === 'denied') return { status: 403, body: { message: 'Commentary unavailable.' } }
      return { body: { review_id: review.id, reviewer: review.reviewer,
        annotations: options.ownerVariant === 'empty' ? [] : ownerToolsRows(review.id) } }
    }
    case '/api/speeches/9/annotations/owner-a-voice/voice-playback-url':
    case '/api/speeches/9/annotations/owner-b-voice/voice-playback-url': return { body: { audio: { url: `${APP_URL}/__notebook/voice.m4a`, expires_at: '2030-01-01T00:00:00Z' } } }
  }
}
export function notebookResponse(url: URL, method: string, options: NotebookFixtureOptions, body?: Record<string, unknown>): { body: unknown; status?: number } | undefined {
  const path = url.pathname
  const ownerResponse = ownerToolsResponse(url, method, options)
  if (ownerResponse) return ownerResponse
  if (method === 'PATCH' && /^\/api\/me\/preferences\/commentary-playback\/9$/.test(path)) {
    // State-changing requests stay entirely within this browser fixture.
    if (['all', 'written', 'voice', 'off'].includes(String(body?.mode))) options.playbackMode = body!.mode as NotebookFixtureOptions['playbackMode']
    return { body: { commentary_playback: { speech_id: 9, mode: options.playbackMode ?? 'all', source: 'saved' } } }
  }
  if (method === 'PUT' && path === '/api/speeches/9/essay') return { body: { essay: {
    essay_html: '<p><strong>A clear opening.</strong></p>', essay_text: 'A clear opening.', essay_words: 4,
    essay_published_at: null, essay_updated_at: notebookDate, essay_lock_version: 1,
  } } }
  if (method === 'POST' && path === '/api/speeches') return { body: { speech: notebookSpeech(options) }, status: 201 }
  if (method !== 'GET') return undefined
  const handled = ['/api/speeches', '/api/reviewers', '/api/speeches/search', '/api/u/notebook-member',
    '/api/privacy/exports', '/api/coach-applications/me', '/api/speeches/9', '/api/speeches/9/assets/90/playback-url',
    '/api/speeches/9/captions', '/api/speeches/9/transcript', '/api/speeches/9/reviews', '/api/speeches/9/review-roster',
    '/api/speeches/9/annotations', '/api/speeches/9/annotations/notebook-voice/voice-playback-url', '/api/speeches/9/essay', '/api/me/preferences/commentary-playback/9',
    '/api/me/preferences/voice-commentary/9', ...(options.reviewerOverlay ? ['/api/reviews'] : [])]
  const toolsAudioPath = options.notebookTools && notebookToolsAudioIds.some((id) => path === `/api/speeches/9/annotations/${id}/voice-playback-url`)
  if (!handled.includes(path) && !toolsAudioPath) return undefined
  if (options.mode === 'error') return { status: 500, body: { message: 'Presentation fixture failure.' } }
  const speech = notebookSpeech(options), review = notebookReview(options), empty = options.mode === 'empty'
  switch (path) {
    case '/api/reviews': return { body: { invited: [], in_progress: [review], published: [], revoked: [] } }
    case '/api/speeches': return { body: { speeches: empty ? [] : [speech], meta: { current_page: 1, last_page: 1, total: empty ? 0 : 1 } } }
    case '/api/reviewers': return { body: { reviewers: empty ? [] : [
      { id: 3, name: 'Avery Reviewer', username: 'avery-reviewer', credential: 'coach', avatar_url: null },
      { id: 4, name: 'Jamie Member', username: 'jamie-member', credential: 'member', avatar_url: null },
    ], meta: { current_page: 1, last_page: 1, total: empty ? 0 : 2 } } }
    case '/api/u/notebook-member': return { body: { profile: { id: options.reviewer ? 2 : 1, username: 'notebook-member',
      display_name: 'Morgan Member', bio: 'Practising a clear opening.', location: 'Rehearsal room', avatar_url: null } } }
    case '/api/privacy/exports': return { body: { exports: [] } }
    case '/api/coach-applications/me': return { body: { coachApplication: { id: 7, status: options.coachStatus ?? 'draft',
      statement: 'I want to help speakers practise.', decision_reason: 'Please add supporting experience.', submitted_at: null,
      decided_at: null, documents: [{ id: 1, original_filename: 'Certificate' + 'LongFileName'.repeat(10) + '.pdf', status: 'clean', created_at: notebookDate }] } } }
    case '/api/speeches/search': return { body: { results: empty ? [] : [{ ...speech, search_match: {
      title: [{ text: 'Finding a clear ', matched: false }, { text: 'voice', matched: true }],
      description: [{ text: speech.description, matched: false }], transcript_excerpt: { truncated_before: true, truncated_after: true,
        parts: [{ text: 'Find your ', matched: false }, { text: 'voice', matched: true }, { text: ' and connect with the audience.', matched: false }] },
    } }] } }
    case '/api/speeches/9': return { body: { speech } }
    case '/api/speeches/9/assets/90/playback-url': return { body: { url: `${APP_URL}/__notebook/speech.mp4` } }
    case '/api/speeches/9/captions': if (options.missingCaptions) return { body: { captions: { status: 'failed', asset_id: 91, failure_code: 'fixture_captions_unavailable', updated_at: notebookDate } } }; return { body: { captions: { status: 'ready', asset_id: 91, failure_code: null, updated_at: notebookDate,
      revision: 'notebook-revision', vtt: 'WEBVTT\n\n00:00.000 --> 00:03.000\nFind your voice.\n' } } }
    case '/api/speeches/9/transcript': return { body: { transcript: { body: 'Find your voice.', segments: [{ start: 0, end: 3, text: 'Find your voice.' }],
      word_count: 3, words_per_minute: 60, language: 'en', model: 'fixture', source: 'whisper', updated_at: notebookDate, caption_revision: 'notebook-revision' } } }
    case '/api/speeches/9/reviews': return { body: { reviews: [review] } }
    case '/api/speeches/9/review-roster': return { body: { reviews: [{ ...review, annotations_count: options.feedback ? (options.notebookTools ? 13 : 2) : 0, published_annotations_count: options.feedback ? (options.notebookTools ? 13 : 2) : 0, revoked_by_is_self: false }] } }
    case '/api/speeches/9/annotations':
      if (options.reviewerOverlay && url.searchParams.get('review_id') !== String(review.id)) return { status: 403, body: { message: 'Unexpected fixture review denied.' } }
      return { body: { review_id: options.reviewerOverlay ? review.id : Number(url.searchParams.get('review_id')), reviewer: review.reviewer, annotations: options.feedback && options.notebookTools ? notebookToolsAnnotations() : options.feedback ? [
      { id: 'notebook-written', timing_type: 'range', start_seconds: options.reviewerOverlay ? .4 : 0, duration_seconds: options.reviewerOverlay ? .5 : .8, kind: 'observation', topic: null,
        body: options.writtenBody ?? (options.reviewerOverlay ? 'Pause briefly before the opening sentence. Give the audience a moment to settle, then begin with a warm and confident voice.' : 'Pause briefly before the opening sentence.'), lock_version: 1, client_uuid: 'notebook-written', voice: null },
      { id: 'notebook-voice', timing_type: 'point', start_seconds: 1.2, duration_seconds: 10, kind: 'observation', topic: null,
        body: 'Your opening sounds warm and confident.', lock_version: 1, client_uuid: 'notebook-voice',
        voice: { asset_id: 92, audio_status: 'ready', transcript_status: 'ready', failure_code: null } },
    ] : [] } }
    case '/api/speeches/9/annotations/tools-voice-historic/voice-playback-url':
    case '/api/speeches/9/annotations/tools-voice-ready-2/voice-playback-url':
    case '/api/speeches/9/annotations/tools-voice-ready-3/voice-playback-url':
    case '/api/speeches/9/annotations/notebook-voice/voice-playback-url': return { body: { audio: { url: `${APP_URL}/__notebook/voice.m4a`, expires_at: '2030-01-01T00:00:00Z' } } }
    case '/api/speeches/9/essay': return { body: { essay: { essay_html: '<p>A clear opening.</p>', essay_text: 'A clear opening.', essay_words: 4,
      essay_published_at: null, essay_updated_at: notebookDate, essay_lock_version: 0 } } }
    case '/api/me/preferences/commentary-playback/9': return { body: { commentary_playback: { speech_id: 9, mode: options.playbackMode ?? 'all', source: 'saved' } } }
    case '/api/me/preferences/voice-commentary/9': return { body: { voice_commentary: { speech_id: 9, mode: 'auto', experienced: true } } }
  }
}
export async function notebookMediaResponse(route: import('@playwright/test').Route, options: NotebookFixtureOptions) {
  const voice = new URL(route.request().url()).pathname === '/__notebook/voice.m4a'
  const bytes = voice ? await readFile(fileURLToPath(new URL('../../api/tests/fixtures/whisper-smoke/spoken-fixture.m4a', import.meta.url)))
    : options.media ?? await readFile(fileURLToPath(new URL('../../api/tests/fixtures/e2e-captions/caption-fixture.mp4', import.meta.url)))
  if (!['/__notebook/speech.mp4', '/__notebook/voice.m4a'].includes(new URL(route.request().url()).pathname) || !['GET', 'HEAD'].includes(route.request().method())) return route.abort('blockedbyclient')
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/)
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
  return route.fulfill({ status: range ? 206 : 200, body: bytes.subarray(start, end + 1), headers: {
    'content-type': voice ? 'audio/mp4' : 'video/mp4', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-length': String(end - start + 1),
    ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
  } })
}
