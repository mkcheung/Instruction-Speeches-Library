import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { USERS, VOICE } from './fixtures.js'
import {
  installDeterministicRecorder,
  openSpeech,
  recorderAttempts,
  VOICE_FIXTURE_BYTES,
} from './voice-test-helpers.js'

test('forced reported-supported/start-throws MIME fallback reaches a local preview', async ({ browser }) => {
  const context = await browser.newContext({ storageState: USERS.reviewerA.storageState })
  const page = await context.newPage()
  await installDeterministicRecorder(page)
  let uploadRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/speeches/${VOICE.coachSpeechId}/voice-notes`)) {
      uploadRequests += 1
    }
  })

  await openSpeech(page, VOICE.coachSpeechId)
  const recorder = page.getByRole('region', { name: 'Record a voice note' })
  await recorder.getByRole('button', { name: /^Record/ }).click()
  await recorder.getByRole('button', { name: 'Stop' }).click()

  const preview = recorder.getByLabel('Voice note preview')
  await expect(preview).toBeVisible()
  const previewBytes = await preview.getByLabel('Preview voice note').evaluate(async (node) =>
    Array.from(new Uint8Array(await (await fetch((node as unknown as { src: string }).src)).arrayBuffer())),
  )
  const previewBuffer = Buffer.from(previewBytes)
  expect(previewBuffer.byteLength).toBe(VOICE_FIXTURE_BYTES.byteLength)
  expect(createHash('sha256').update(previewBuffer).digest('hex'))
    .toBe(createHash('sha256').update(VOICE_FIXTURE_BYTES).digest('hex'))
  expect(await recorderAttempts(page)).toEqual([
    { phase: 'construct', mimeType: 'audio/webm;codecs=opus' },
    { phase: 'start', mimeType: 'audio/webm;codecs=opus' },
    { phase: 'construct', mimeType: 'audio/mp4;codecs=mp4a.40.2' },
    { phase: 'start', mimeType: 'audio/mp4;codecs=mp4a.40.2' },
  ])
  expect(uploadRequests).toBe(0)
  await recorder.getByRole('button', { name: 'Re-record' }).click()
  await expect(recorder.getByLabel('Voice note preview')).toHaveCount(0)
  expect(uploadRequests).toBe(0)

  await context.close()
})
