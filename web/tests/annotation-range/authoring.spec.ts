import { test, expect, type Page, type Browser, type TestInfo } from '@playwright/test'
import { installDeterministicRecorder } from '../voice-test-helpers.js'

const API = 'http://127.0.0.1:8180'
const APP = 'http://127.0.0.1:5180'
const speechFor = (testInfo: TestInfo, slot: number) => ({ chromium: 0, webkit: 3, 'mobile-webkit': 6 }[testInfo.project.name] ?? 0) + slot
async function login(page: Page, role: 'coach' | 'owner' = 'coach') {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(`range-${role}@e2e.test`)
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
}
async function open(page: Page, speechId: number) {
  await page.goto(`/speeches/${speechId}`)
  await expect(page.getByRole('region', { name: 'New annotation', exact: true })).toBeVisible()
  await expect.poll(() => page.getByTestId('speech-video').evaluate((node) => (node as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
}
function composer(page: Page) { return page.getByRole('region', { name: 'New annotation', exact: true }) }
async function fill(page: Page, start: string, end: string, body: string) {
  const form = composer(page)
  await form.getByRole('textbox', { name: 'Start', exact: true }).fill(start)
  await form.getByRole('textbox', { name: 'End', exact: true }).fill(end)
  await form.getByRole('textbox', { name: 'Commentary', exact: true }).fill(body)
}
async function add(page: Page) {
  const response = page.waitForResponse((response) => response.url().endsWith('/annotations') && response.request().method() === 'POST')
  await composer(page).getByRole('button', { name: 'Add annotation', exact: true }).click()
  const saved = await response
  expect(saved.status()).toBe(201)
  return (await saved.json()).annotation as { id: string; client_uuid: string; start_seconds: number }
}
async function ownerPage(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${APP}/login`)
  await login(page, 'owner')
  return { context, page }
}

test('captures explicit endpoints, adds private drafts, edits/cancels and publishes', async ({ page, browser }, testInfo) => {
  const speechId = speechFor(testInfo, 1)
  await login(page); await open(page, speechId)
  const form = composer(page)
  let posts = 0
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().endsWith('/annotations')) posts++ })
  const video = page.getByTestId('speech-video')
  await video.evaluate((node) => { const video = node as HTMLVideoElement; video.currentTime = 1; video.pause() })
  await form.getByRole('button', { name: 'Use current time for start' }).click()
  await expect(form.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0:01.000')
  await expect(form.getByRole('textbox', { name: 'End', exact: true })).toHaveValue('')
  await video.evaluate((node) => { (node as HTMLVideoElement).currentTime = 2 })
  await form.getByRole('button', { name: 'Use current time for end' }).click()
  await form.getByRole('textbox', { name: 'Commentary', exact: true }).fill('  Explicit range feedback\n')
  await page.waitForTimeout(1000) // Proves the removed debounce does not write.
  expect(posts).toBe(0)
  await expect(page.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
  await expect(form.getByLabel('Kind')).toHaveCount(0)
  await expect(form.getByLabel('Topic')).toHaveCount(0)
  await add(page)
  await expect(form.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('')
  const list = page.getByRole('list', { name: 'Your commentary', exact: true })
  await expect(list).toContainText('0:01.000–0:02.000')
  const owner = await ownerPage(browser)
  const privateResponse = await owner.page.request.get(`${API}/api/speeches/${speechId}/annotations?review_id=${speechId}`, { headers: { Accept: 'application/json', Origin: APP } })
  expect(privateResponse.status()).toBe(200)
  expect((await privateResponse.json()).annotations).toHaveLength(0)
  await list.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('region', { name: 'Editing annotation', exact: true })
  await edit.getByRole('textbox', { name: 'Commentary', exact: true }).fill('Cancel this local edit')
  await expect(page.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(list).toContainText('Explicit range feedback')
  await expect(list).not.toContainText('Cancel this local edit')
  await fill(page, '1.5', '2.5', 'Overlap is retained locally')
  await expect(form.getByRole('button', { name: 'Add annotation' })).toBeDisabled()
  await expect(form).toContainText('overlaps')
  await form.getByRole('button', { name: 'Discard new note' }).click()
  await fill(page, '2', '2.5', 'Adjacent is allowed')
  await add(page)
  await expect(list.getByRole('listitem')).toHaveCount(2)
  const published = page.waitForResponse((response) => response.url().includes('/publish') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Publish feedback' }).click()
  expect((await published).status()).toBe(200)
  const publicResponse = await owner.page.request.get(`${API}/api/speeches/${speechId}/annotations?review_id=${speechId}`, { headers: { Accept: 'application/json', Origin: APP } })
  expect((await publicResponse.json()).annotations).toHaveLength(2)
  await owner.context.close()
})

test('separate tabs retain separate drafts and reload offers explicit recovery', async ({ page, context }, testInfo) => {
  const speechId = speechFor(testInfo, 2)
  await login(page); await open(page, speechId)
  const sibling = await context.newPage()
  await open(sibling, speechId)
  await fill(page, '1', '2', 'First tab draft')
  await fill(sibling, '1', '2', 'Second tab draft')
  await add(page)
  await expect(composer(sibling)).toContainText('overlaps', { timeout: 10_000 })
  await expect(composer(sibling).getByRole('textbox', { name: 'Commentary', exact: true })).toHaveValue('Second tab draft')
  sibling.on('dialog', (dialog) => void dialog.accept())
  await sibling.reload()
  const form = composer(sibling)
  await expect(form.getByRole('textbox', { name: 'Commentary', exact: true })).toHaveValue('')
  await expect(form.getByLabel('Recoverable drafts')).toContainText('Second tab draft')
  await form.getByRole('button', { name: 'Restore draft', exact: true }).click()
  await expect(form.getByRole('textbox', { name: 'Commentary', exact: true })).toHaveValue('Second tab draft')
  await expect(form.getByRole('button', { name: 'Add annotation' })).toBeDisabled()
  await form.getByRole('textbox', { name: 'Start', exact: true }).fill('2')
  await form.getByRole('textbox', { name: 'End', exact: true }).fill('3')
  await add(sibling)
  await expect(sibling.getByRole('list', { name: 'Your commentary', exact: true }).getByRole('listitem')).toHaveCount(2)
  await sibling.close()
})

test('a stopped recording survives an uncertain upload and retries its original point', async ({ page }, testInfo) => {
  const speechId = speechFor(testInfo, 3)
  await installDeterministicRecorder(page)
  await login(page); await open(page, speechId)
  const recorder = page.getByRole('region', { name: 'Record a voice note' })
  await recorder.getByRole('textbox', { name: 'Voice note position' }).fill('1.25')
  await recorder.getByRole('button', { name: /^Record/ }).click()
  await recorder.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(recorder.getByLabel('Voice note preview')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish feedback' })).toBeDisabled()
  let first = true
  const payloads: string[] = []
  await page.route(`${API}/api/speeches/${speechId}/voice-notes`, async (route) => {
    const data = route.request().postData() ?? ''
    const uuid = /name="client_uuid"\r\n\r\n([^\r]+)/.exec(data)?.[1]
    payloads.push(uuid ?? '')
    if (first) { first = false; await route.abort('failed') } else await route.continue()
  })
  await recorder.getByRole('button', { name: 'Save voice note' }).click()
  await expect(recorder).toContainText('upload outcome is uncertain')
  await expect(recorder.getByRole('textbox', { name: 'Voice note position' })).toBeDisabled()
  await expect(recorder.getByRole('button', { name: 'Re-record', exact: true })).toBeDisabled()
  await page.waitForTimeout(3300) // An empty own-review poll cannot establish failure.
  await expect(recorder.getByRole('textbox', { name: 'Voice note position' })).toBeDisabled()
  const saved = page.waitForResponse((response) => response.url().endsWith('/voice-notes') && response.request().method() === 'POST')
  await recorder.getByRole('button', { name: 'Retry original upload' }).click()
  const result = await saved
  expect(result.status(), result.status() === 202 ? undefined : (await result.json()).message).toBe(202)
  expect((await result.json()).annotation).toMatchObject({ timing_type: 'point', start_seconds: 1.25 })
  expect(payloads).toHaveLength(2)
  expect(payloads[0]).not.toBe('')
  expect(payloads[1]).toBe(payloads[0])
  await expect(recorder.getByLabel('Voice note preview')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publish feedback' })).toBeEnabled()
})
