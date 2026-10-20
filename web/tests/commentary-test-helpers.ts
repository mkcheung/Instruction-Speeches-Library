import { expect, type Page } from '@playwright/test'

export type PlaybackLabel = 'Text + audio' | 'Written notes only' | 'Audio only' | 'Off'

export async function selectPlaybackMode(page: Page, name: PlaybackLabel): Promise<void> {
  const group = page.getByRole('radiogroup', { name: 'Commentary playback' })
  const option = group.getByRole('radio', { name, exact: true })
  await expect(option).toBeEnabled()
  if (await option.isChecked()) return
  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && response.url().includes('/preferences/commentary-playback/'))
  await group.getByText(name, { exact: true }).click()
  expect((await saved).status()).toBe(200)
  await expect(option).toBeChecked()
}
