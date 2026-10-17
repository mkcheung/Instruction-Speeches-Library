import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { SpeechDeleteDialog } from '@/components/speech/SpeechDeleteDialog'
import type { Speech } from '@/features/speech/types'

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

const SPEECH: Speech = {
  id: 99,
  ulid: '01SPEECH',
  user_id: 1,
  title: 'A speech to remove',
  description: null,
  delivered_on: null,
  change_note: null,
  created_at: '2026-01-01T00:00:00Z',
  captions_enabled: true,
  primary_video: null,
}

describe('SpeechDeleteDialog', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the confirm button disabled until the exact word "REMOVE" is typed', async () => {
    const user = userEvent.setup()
    render(<SpeechDeleteDialog speech={SPEECH} open onOpenChange={() => {}} />, { wrapper })

    const dialog = await screen.findByTestId('speech-delete-dialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Remove speech' })
    expect(confirmButton).toBeDisabled()

    const input = screen.getByLabelText(/Type/)
    await user.type(input, 'remove')
    expect(confirmButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'DELETE')
    expect(confirmButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'REMOVE')
    expect(confirmButton).not.toBeDisabled()
  })

  it('states the exact "erased within 24 hours" honesty-posture copy', async () => {
    render(<SpeechDeleteDialog speech={SPEECH} open onOpenChange={() => {}} />, { wrapper })

    expect(
      await screen.findByText('Removed now. The video file is erased within 24 hours.'),
    ).toBeInTheDocument()
  })

  it('calls the delete mutation and closes the dialog on success', async () => {
    let sawDelete = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/99') && methodOf(input, init) === 'DELETE') {
        sawDelete = true
        return new Response(null, { status: 204 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<SpeechDeleteDialog speech={SPEECH} open onOpenChange={onOpenChange} />, { wrapper })

    await user.type(screen.getByLabelText(/Type/), 'REMOVE')
    const dialog = screen.getByTestId('speech-delete-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove speech' }))

    await waitFor(() => expect(sawDelete).toBe(true))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  /**
   * code-review finding: this used to discard the real server error and
   * always show a generic "try again" — including for a 410 (the speech
   * was already removed elsewhere), where that's actively misleading.
   */
  it('surfaces the real server error message instead of a generic one', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/99') && methodOf(input, init) === 'DELETE') {
        return new Response(JSON.stringify({ message: 'This speech has been deleted.' }), {
          status: 410,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<SpeechDeleteDialog speech={SPEECH} open onOpenChange={() => {}} />, { wrapper })

    await user.type(screen.getByLabelText(/Type/), 'REMOVE')
    const dialog = screen.getByTestId('speech-delete-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove speech' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This speech has been deleted.')
  })
})
