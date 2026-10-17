import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import { SpeechEditDialog } from '@/components/speech/SpeechEditDialog'
import type { Speech } from '@/features/speech/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (input instanceof Request) {
    const text = await input.clone().text()
    return text ? JSON.parse(text) : undefined
  }
  return init?.body ? JSON.parse(init.body as string) : undefined
}

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={createTestStore()}>{children}</Provider>
}

const SPEECH: Speech = {
  id: 42,
  ulid: '01SPEECH',
  user_id: 1,
  title: 'My first speech',
  description: 'An original description',
  delivered_on: '2026-01-15',
  change_note: null,
  created_at: '2026-01-01T00:00:00Z',
  captions_enabled: true,
  primary_video: null,
}

describe('SpeechEditDialog', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('pre-fills the form from the passed speech', async () => {
    render(<SpeechEditDialog speech={SPEECH} open onOpenChange={() => {}} />, { wrapper })

    const dialog = await screen.findByTestId('speech-edit-dialog')
    expect(screen.getByLabelText('Title')).toHaveValue('My first speech')
    expect(screen.getByLabelText('Description')).toHaveValue('An original description')
    expect(screen.getByLabelText('Delivered on')).toHaveValue('2026-01-15')
    expect(dialog).toBeInTheDocument()
  })

  it('submits only the fields that changed', async () => {
    let capturedBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/42') && methodOf(input, init) === 'PATCH') {
        capturedBody = await bodyOf(input, init)
        return jsonResponse({ speech: { ...SPEECH, title: 'Updated title' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<SpeechEditDialog speech={SPEECH} open onOpenChange={onOpenChange} />, { wrapper })

    const titleInput = screen.getByLabelText('Title')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated title')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(capturedBody).toEqual({ title: 'Updated title' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows a server validation error when the mutation rejects with a 422', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/speeches/42') && methodOf(input, init) === 'PATCH') {
        return jsonResponse({ message: 'The given data was invalid.', errors: { title: ['Title is required.'] } }, 422)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<SpeechEditDialog speech={SPEECH} open onOpenChange={() => {}} />, { wrapper })

    const titleInput = screen.getByLabelText('Title')
    await user.clear(titleInput)
    await user.type(titleInput, 'Something else')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Title is required.')).toBeInTheDocument()
  })
})
