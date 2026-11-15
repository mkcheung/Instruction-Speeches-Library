import { expect, type Locator, type Page } from '@playwright/test'

export type PlaybackLabel = 'Text + audio' | 'Written notes only' | 'Audio only' | 'Off'

/** The speaker's reviewer picker (TrackSelector.tsx:36). The one e2e owner of its accessible name. */
export function commentaryTracks(page: Page): Locator {
  return page.getByRole('radiogroup', { name: 'Choose commentary track' })
}

/** Selects a reviewer's commentary the way the specs always have: Space on its radio. */
export async function chooseCommentaryTrack(page: Page, reviewer: string): Promise<void> {
  await commentaryTracks(page).getByRole('radio', { name: reviewer }).press('Space')
}

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
