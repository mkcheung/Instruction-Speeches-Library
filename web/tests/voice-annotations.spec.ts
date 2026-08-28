import { expect, test, type Page, type Response } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { API_URL, APP_URL, POSTGRES_CONTAINER, USERS, VOICE } from './fixtures.js'
import {
  deterministicAudioEvents,
  finishDeterministicAudio,
  installDeterministicRecorder,
  installDeterministicVoiceAudio,
  openSpeech,
  recorderAttempts,
  resetVoiceFixtures,
  VOICE_FIXTURE_BYTES,
  xsrfHeader,
} from './voice-test-helpers.js'

test.describe.configure({ mode: 'serial', timeout: 180_000 })
test.skip(({ browserName }) => browserName !== 'chromium', 'mutable real-stack scenarios are Chromium-only')

const JSON_HEADERS = { Accept: 'application/json', Origin: APP_URL } as const

interface VoiceAnnotationPayload {
  id: string
  client_uuid: string
  voice: null | {
    asset_id: number
    audio_status: 'processing' | 'ready' | 'failed'
    transcript_status: 'pending' | 'processing' | 'ready' | 'failed'
  }
}

function voicePost(response: Response): boolean {
  return response.url() === `${API_URL}/api/speeches/${VOICE.coachSpeechId}/voice-notes`
}

async function annotations(page: Page): Promise<VoiceAnnotationPayload[]> {
  const response = await page.request.get(
    `${API_URL}/api/speeches/${VOICE.coachSpeechId}/annotations?review_id=${VOICE.coachReviewId}`,
    { headers: JSON_HEADERS },
  )
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { annotations: VoiceAnnotationPayload[] }).annotations
}

interface BrowserVideo {
  readyState: number
  currentTime: number
  muted: boolean
  paused: boolean
  play: () => Promise<void>
  addEventListener: (type: 'play', listener: () => void) => void
}

async function prepareSpeakerInterjection(page: Page, explicitlySelectPlay = true): Promise<void> {
  await openSpeech(page, VOICE.coachSpeechId)
  await page.getByRole('radiogroup', { name: 'Choose commentary track' }).getByRole('radio', { name: USERS.reviewerA.name }).click()
  await expect(page.getByRole('button', { name: /Annotation at 0 seconds Ordinary text remains visible/ })).toBeVisible()
  if (!explicitlySelectPlay) return
  const playMode = page.getByRole('radiogroup', { name: 'Voice commentary' }).getByRole('radio', { name: 'Play commentary' })
  const persisted = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/preferences/voice-commentary/'),
  )
  await playMode.click()
  expect((await persisted).status()).toBe(200)
}

async function startNaturalCrossing(page: Page) {
  const video = page.getByTestId('speech-video')
  await expect.poll(() => video.evaluate((node) => (node as unknown as BrowserVideo).readyState)).toBeGreaterThanOrEqual(1)
  await video.evaluate(async (node) => {
    const element = node as unknown as BrowserVideo
    const state = globalThis as typeof globalThis & { __voiceVideoPlayCount?: number }
    state.__voiceVideoPlayCount = 0
    element.addEventListener('play', () => {
      state.__voiceVideoPlayCount = (state.__voiceVideoPlayCount ?? 0) + 1
    })
    element.muted = true
    element.currentTime = 0.2
  })
  await expect(page.getByText('🔊 Commentary ahead')).toBeVisible()
  await video.evaluate(async (node) => {
    const element = node as unknown as BrowserVideo
    await element.play()
  })
  return video
}

async function expectVideoToAdvance(video: ReturnType<Page['getByTestId']>): Promise<void> {
  const before = await video.evaluate((node) => (node as unknown as BrowserVideo).currentTime)
  await expect.poll(
    () => video.evaluate((node) => (node as unknown as BrowserVideo).currentTime),
    { message: 'video clock did not advance after commentary recovery' },
  ).toBeGreaterThan(before + 0.05)
}

async function expectVideoToStayAtManualPause(video: ReturnType<Page['getByTestId']>): Promise<void> {
  const before = await video.evaluate((node) => (node as unknown as BrowserVideo).currentTime)
  await video.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)))
  const after = await video.evaluate((node) => (node as unknown as BrowserVideo).currentTime)
  expect(Math.abs(after - before)).toBeLessThan(0.05)
}

test.beforeEach(() => resetVoiceFixtures())

test('Scenario A — Coach sees recording while a Member is denied by the real direct endpoint', async ({ browser }) => {
  const coachContext = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const coachPage = await coachContext.newPage()
  await installDeterministicRecorder(coachPage)
  await openSpeech(coachPage, VOICE.coachSpeechId)
  await expect(coachPage.getByRole('region', { name: 'Record a voice note' })).toBeVisible()
  await expect(coachPage.getByRole('button', { name: /^Record/ })).toBeVisible()

  const memberContext = await browser.newContext({ storageState: USERS.speaker.storageState })
  const memberPage = await memberContext.newPage()
  await installDeterministicRecorder(memberPage)
  await openSpeech(memberPage, VOICE.memberReviewSpeechId)
  await expect(memberPage.getByText('Your commentary')).toBeVisible()
  await expect(memberPage.getByRole('region', { name: 'Record a voice note' })).toHaveCount(0)

  const response = await memberPage.request.post(
    `${API_URL}/api/speeches/${VOICE.memberReviewSpeechId}/voice-notes`,
    {
      headers: { ...JSON_HEADERS, ...(await xsrfHeader(memberContext)) },
      multipart: {
        audio: { name: 'voice-fixture.m4a', mimeType: 'audio/mp4', buffer: VOICE_FIXTURE_BYTES },
        client_uuid: '0e2e0000-0000-4000-8000-000000019602',
        start_seconds: '1.25',
      },
    },
  )
  expect(response.status()).toBe(403)

  const speakerDraft = await memberPage.request.get(
    `${API_URL}/api/speeches/${VOICE.coachSpeechId}/annotations/${VOICE.peerDraftVoiceAnnotationId}/voice-playback-url`,
    { headers: JSON_HEADERS },
  )
  expect(speakerDraft.status(), 'speaker must not enumerate a draft voice row').toBe(404)
  const peerDraft = await coachPage.request.get(
    `${API_URL}/api/speeches/${VOICE.coachSpeechId}/annotations/${VOICE.peerDraftVoiceAnnotationId}/voice-playback-url`,
    { headers: JSON_HEADERS },
  )
  // 404, not 403: a peer reviewer's annotation on this same speech clears
  // the endpoint's speech_id check, so a 403 here would have made the
  // authorization outcome an id oracle (403 = the peer's voice note exists,
  // 404 = nothing there). The peer probe and a nonexistent id must be
  // indistinguishable — see VoiceAnnotationController::audioUrl.
  expect(peerDraft.status(), 'peer reviewer must not read another reviewer\'s voice row').toBe(404)
  const peerMissing = await coachPage.request.get(
    `${API_URL}/api/speeches/${VOICE.coachSpeechId}/annotations/99999999/voice-playback-url`,
    { headers: JSON_HEADERS },
  )
  expect(peerDraft.status(), 'a peer voice row must be indistinguishable from a nonexistent one').toBe(peerMissing.status())

  const authorContext = await browser.newContext({ storageState: USERS.reviewerB.storageState })
  const authorDraft = await authorContext.request.get(
    `${API_URL}/api/speeches/${VOICE.coachSpeechId}/annotations/${VOICE.peerDraftVoiceAnnotationId}/voice-playback-url`,
    { headers: JSON_HEADERS },
  )
  expect(authorDraft.status(), 'draft author retains access to their own ready voice row').toBe(200)

  await coachContext.close()
  await memberContext.close()
  await authorContext.close()
})

test('Scenario B — fallback/rerecord posts once; real FFmpeg reaches ready without Whisper', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const page = await context.newPage()
  await installDeterministicRecorder(page)
  let voicePosts = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${API_URL}/api/speeches/${VOICE.coachSpeechId}/voice-notes`) {
      voicePosts += 1
    }
  })

  await openSpeech(page, VOICE.coachSpeechId)
  const recorder = page.getByRole('region', { name: 'Record a voice note' })

  await recorder.getByRole('button', { name: /^Record/ }).click()
  await recorder.getByRole('button', { name: 'Stop' }).click()
  await expect(recorder.getByLabel('Voice note preview')).toBeVisible()
  expect(await recorderAttempts(page)).toEqual([
    { phase: 'construct', mimeType: 'audio/webm;codecs=opus' },
    { phase: 'start', mimeType: 'audio/webm;codecs=opus' },
    { phase: 'construct', mimeType: 'audio/mp4;codecs=mp4a.40.2' },
    { phase: 'start', mimeType: 'audio/mp4;codecs=mp4a.40.2' },
  ])
  expect(voicePosts).toBe(0)

  await recorder.getByRole('button', { name: 'Re-record' }).click()
  await expect(recorder.getByLabel('Voice note preview')).toHaveCount(0)
  expect(voicePosts).toBe(0)
  await recorder.getByRole('button', { name: /^Record/ }).click()
  await recorder.getByRole('button', { name: 'Stop' }).click()

  const responsePromise = page.waitForResponse(voicePost)
  await recorder.getByRole('button', { name: 'Save voice note' }).click()
  const response = await responsePromise
  expect(response.status()).toBe(202)
  expect(voicePosts).toBe(1)
  const created = ((await response.json()) as { annotation: VoiceAnnotationPayload }).annotation

  // The E2E ffmpeg-worker is the production image/binding and consumes the
  // real transcode queue. Both Whisper consumers stay stopped in this lane,
  // so ready audio + pending transcript is the intentional boundary—not a
  // fake transcript success masquerading as model evidence.
  await expect
    .poll(
      async () => (await annotations(page)).find((row) => row.id === created.id)?.voice,
      { timeout: 90_000, message: 'real normalization worker never made the uploaded voice note ready' },
    )
    .toMatchObject({ audio_status: 'ready', transcript_status: 'pending' })

  const databaseCounts = execFileSync(
    'docker',
    [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-U',
      'speechcoach',
      '-d',
      'speechcoach',
      '-Atc',
      `select count(*), count(*) filter (where is_primary) from speech_assets where speech_id=${VOICE.coachSpeechId} and kind='voice_note'`,
    ],
    { encoding: 'utf8' },
  ).trim()
  const [voiceCount, primaryVoiceCount] = databaseCounts.split('|').map(Number)
  expect(voiceCount).toBeGreaterThanOrEqual(8)
  expect(primaryVoiceCount).toBe(0)
  await context.close()
})

test('Scenario C — a natural crossing fetches signed audio, pauses, shows transcript, and resumes', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await context.newPage()
  await installDeterministicVoiceAudio(page, 'natural')
  await prepareSpeakerInterjection(page, false)
  const automaticPreference = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/preferences/voice-commentary/'),
  )
  const video = await startNaturalCrossing(page)

  await expect(page.getByText('Playing voice commentary')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(VOICE.pendingTranscript).first()).toBeVisible()
  const publishedVoice = (await annotations(page)).find((row) => row.id === String(VOICE.firstVoiceAnnotationId))
  expect(publishedVoice, 'the speaker API must expose the seeded published voice row').toBeDefined()
  const publicationFlag = execFileSync(
    'docker',
    [
      'exec',
      POSTGRES_CONTAINER,
      'psql',
      '-U',
      'speechcoach',
      '-d',
      'speechcoach',
      '-Atc',
      `select (published_at is not null)::int from annotations where id=${VOICE.firstVoiceAnnotationId}`,
    ],
    { encoding: 'utf8' },
  ).trim()
  expect(publicationFlag).toBe('1')
  expect(await video.evaluate((node) => (node as unknown as BrowserVideo).paused)).toBe(true)
  await expect
    .poll(async () => (await deterministicAudioEvents(page)).find((event) => event.phase === 'range'))
    .toMatchObject({ status: 206, bytes: 32 })
  await expectVideoToAdvance(video)
  expect((await automaticPreference).status()).toBe(200)
  await context.close()

  const nextVisitContext = await browser.newContext({ storageState: USERS.speaker.storageState })
  const nextVisitPage = await nextVisitContext.newPage()
  await openSpeech(nextVisitPage, VOICE.coachSpeechId)
  await nextVisitPage.getByRole('radiogroup', { name: 'Choose commentary track' })
    .getByRole('radio', { name: USERS.reviewerA.name }).click()
  await expect(nextVisitPage.getByRole('radiogroup', { name: 'Voice commentary' }).getByRole('radio', { name: 'Text only' }))
    .toHaveAttribute('aria-checked', 'true')
  await nextVisitContext.close()
})

test('Scenario D — Skip, Escape, manual intent, rejection, and watchdog all recover safely', async ({ browser }) => {
  const runCase = async (mode: 'natural' | 'hold' | 'reject') => {
    const context = await browser.newContext({ storageState: USERS.speaker.storageState })
    const page = await context.newPage()
    await installDeterministicVoiceAudio(page, mode)
    await prepareSpeakerInterjection(page)
    const video = await startNaturalCrossing(page)
    return { context, page, video }
  }

  {
    const { context, page, video } = await runCase('hold')
    await expect(page.getByText('Playing voice commentary')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^Skip/ }).click()
    await expectVideoToAdvance(video)
    await context.close()
  }

  {
    const { context, page, video } = await runCase('hold')
    await expect(page.getByText('Playing voice commentary')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expectVideoToAdvance(video)
    await context.close()
  }

  {
    const { context, page, video } = await runCase('hold')
    await expect(page.getByText('Playing voice commentary')).toBeVisible({ timeout: 10_000 })
    await video.evaluate((node) => (node as unknown as BrowserVideo).play())
    await expect.poll(() => video.evaluate((node) => (node as unknown as BrowserVideo).paused)).toBe(true)
    await finishDeterministicAudio(page)
    await expect(page.getByText('Playing voice commentary')).toHaveCount(0)
    await expectVideoToStayAtManualPause(video)
    await context.close()
  }

  {
    const { context, page, video } = await runCase('reject')
    await expect.poll(async () => (await deterministicAudioEvents(page)).some((event) => event.mode === 'reject')).toBe(true)
    await expectVideoToAdvance(video)
    await context.close()
  }

  {
    const { context, page, video } = await runCase('hold')
    await expect(page.getByText('Playing voice commentary')).toBeVisible({ timeout: 10_000 })
    expect(await video.evaluate((node) => (node as unknown as BrowserVideo).paused)).toBe(true)
    const pauseEventsBeforeWatchdog = (await deterministicAudioEvents(page)).filter((event) => event.phase === 'pause').length
    const videoPlaysBeforeWatchdog = await page.evaluate(() => {
      const state = globalThis as typeof globalThis & { __voiceVideoPlayCount?: number }
      return state.__voiceVideoPlayCount ?? 0
    })
    await expect
      .poll(async () => (await deterministicAudioEvents(page)).filter((event) => event.phase === 'pause').length, {
        timeout: 15_000,
        message: 'duration + 3 second safety watchdog never cleaned up held audio',
      })
      .toBeGreaterThan(pauseEventsBeforeWatchdog)
    await expect.poll(() => page.evaluate(() => {
      const state = globalThis as typeof globalThis & { __voiceVideoPlayCount?: number }
      return state.__voiceVideoPlayCount ?? 0
    })).toBeGreaterThan(videoPlaysBeforeWatchdog)
    // The next seeded note may be crossed immediately after this resume and
    // legitimately pause the video again. The held audio cleanup plus a new
    // native video play event above is the non-vacuous recovery proof; a
    // sustained clock assertion would incorrectly reject that next note.
    await context.close()
  }
})

test('Scenario E — warning, signed Range audio, modes, and per-speech preference are real', async ({ browser }) => {
  const coachContext = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const coachPage = await coachContext.newPage()
  await installDeterministicRecorder(coachPage)
  await openSpeech(coachPage, VOICE.coachSpeechId)
  await expect(coachPage.getByText('This review has 7 voice notes adding about 25 seconds of interruptions.')).toBeVisible()
  await coachContext.close()

  const speakerContext = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await speakerContext.newPage()
  await openSpeech(page, VOICE.coachSpeechId)
  await page.getByRole('radiogroup', { name: 'Choose commentary track' }).getByRole('radio', { name: USERS.reviewerA.name }).click()
  await expect(page.getByRole('button', { name: /Annotation at 0 seconds Ordinary text remains visible/ })).toBeVisible()

  await page.getByRole('radiogroup', { name: 'Choose commentary track' }).getByRole('radio', { name: 'No commentary' }).click()
  const emptyTranscript = page.getByRole('list', { name: 'Commentary transcript' })
  await expect(emptyTranscript.getByText('No commentary on this track.')).toBeVisible()
  await expect(emptyTranscript.getByRole('button')).toHaveCount(0)
  await page.getByRole('radiogroup', { name: 'Choose commentary track' }).getByRole('radio', { name: USERS.reviewerA.name }).click()
  await expect(page.getByRole('button', { name: /Annotation at 0 seconds Ordinary text remains visible/ })).toBeVisible()

  const rows = await annotations(page)
  const firstVoice = rows.find((row) => row.id === String(VOICE.firstVoiceAnnotationId))
  expect(firstVoice?.voice?.audio_status).toBe('ready')
  const signed = await page.request.get(
    `${API_URL}/api/speeches/${VOICE.coachSpeechId}/annotations/${VOICE.firstVoiceAnnotationId}/voice-playback-url`,
    { headers: JSON_HEADERS },
  )
  expect(signed.status()).toBe(200)
  const signedUrl = ((await signed.json()) as { audio: { url: string } }).audio.url
  const range = await page.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Range: 'bytes=0-31' } })
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength }
  }, signedUrl)
  expect(range).toEqual({ status: 206, bytes: 32 })

  const voiceModes = page.getByRole('radiogroup', { name: 'Voice commentary' })
  const selectVoiceMode = async (name: 'Text only' | 'None') => {
    const preferenceResponse = page.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.url().includes('/preferences/voice-commentary/'),
    )
    await voiceModes.getByRole('radio', { name }).click()
    expect((await preferenceResponse).status()).toBe(200)
  }
  await selectVoiceMode('Text only')
  const commentaryTranscript = page.getByRole('list', { name: 'Commentary transcript' })
  await expect(commentaryTranscript.getByText(VOICE.pendingTranscript)).toBeVisible()

  await selectVoiceMode('None')
  await expect(commentaryTranscript.getByText(VOICE.pendingTranscript)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Annotation at 0 seconds Ordinary text remains visible/ })).toBeVisible()

  await selectVoiceMode('Text only')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('radiogroup', { name: 'Voice commentary' }).getByRole('radio', { name: 'Text only' }))
    .toHaveAttribute('aria-checked', 'true')
  await speakerContext.close()
})

test('Scenario F — queued erase-self removes audio while preserving Former reviewer transcript', async ({ browser }) => {
  const reviewerContext = await browser.newContext({ storageState: USERS.reviewerB.storageState })
  const reviewerPage = await reviewerContext.newPage()
  const signed = await reviewerPage.request.get(
    `${API_URL}/api/speeches/${VOICE.erasureSpeechId}/annotations/${VOICE.erasureVoiceAnnotationId}/voice-playback-url`,
    { headers: JSON_HEADERS },
  )
  expect(signed.status()).toBe(200)
  const oldAudioUrl = ((await signed.json()) as { audio: { url: string } }).audio.url

  const erase = await reviewerPage.request.delete(`${API_URL}/api/me`, {
    headers: { ...JSON_HEADERS, ...(await xsrfHeader(reviewerContext)) },
  })
  expect(erase.status()).toBe(202)

  const erasureState = () =>
    execFileSync(
      'docker',
      [
        'exec',
        POSTGRES_CONTAINER,
        'psql',
        '-U',
        'speechcoach',
        '-d',
        'speechcoach',
        '-Atc',
        `select coalesce((select reviewer_id::text from reviews where id=${VOICE.erasureReviewId}),'NULL') || '|' || coalesce((select audio_asset_id::text from annotations where id=${VOICE.erasureVoiceAnnotationId}),'NULL') || '|' || (select count(*)::text from speech_assets where id=9721) || '|' || (select body from annotations where id=${VOICE.erasureVoiceAnnotationId})`,
      ],
      { encoding: 'utf8' },
    ).trim()

  await expect
    .poll(erasureState, { timeout: 30_000, message: 'queued erase-self job did not finish its voice slice' })
    .toBe('NULL|NULL|0|This transcript survives reviewer erasure.')
  const loopbackAudioUrl = oldAudioUrl.replace('https://media.speechcoach.test/', 'https://127.0.0.1/')
  const erasedObject = await reviewerPage.request.get(loopbackAudioUrl, {
    headers: { Origin: APP_URL, Host: 'media.speechcoach.test' },
  })
  expect(erasedObject.status()).toBe(404)
  await reviewerContext.close()

  const speakerContext = await browser.newContext({ storageState: USERS.speaker.storageState })
  const page = await speakerContext.newPage()
  await openSpeech(page, VOICE.erasureSpeechId)
  await page.getByRole('radiogroup', { name: 'Choose commentary track' }).getByRole('radio', { name: 'Former reviewer' }).click()
  await expect(
    page.getByRole('list', { name: 'Commentary transcript' }).getByText('This transcript survives reviewer erasure.'),
  ).toBeVisible()
  await expect(page.getByText(/voice audio unavailable|couldn't load.*commentary/i)).toHaveCount(0)
  const erasedRows = await page.request.get(
    `${API_URL}/api/speeches/${VOICE.erasureSpeechId}/annotations?review_id=${VOICE.erasureReviewId}`,
    { headers: JSON_HEADERS },
  )
  expect(erasedRows.status()).toBe(200)
  const erasedAnnotation = ((await erasedRows.json()) as { annotations: VoiceAnnotationPayload[] }).annotations[0]
  expect(erasedAnnotation.voice).toBeNull()
  await speakerContext.close()
})
