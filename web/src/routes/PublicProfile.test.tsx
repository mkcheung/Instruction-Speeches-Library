import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import PublicProfile from '@/routes/PublicProfile'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

describe('PublicProfile', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders avatar, name and bio only — no timeline, no connections rail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/marscheung')) {
        return jsonResponse({
          profile: {
            username: 'marscheung',
            display_name: 'Mars Cheung',
            pronouns: null,
            bio: 'Toastmaster and reviewer.',
            location: null,
            avatar_url: null,
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(
      <Routes>
        <Route path="/u/:username" element={<PublicProfile />} />
      </Routes>,
      { route: '/u/marscheung' },
    )

    expect(await screen.findByText('Mars Cheung')).toBeInTheDocument()
    expect(screen.getByText('Toastmaster and reviewer.')).toBeInTheDocument()
    expect(screen.getByText('@marscheung')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders a Coach badge when the profile credential is coach', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/coachy')) {
        return jsonResponse({
          profile: {
            username: 'coachy',
            display_name: 'Coach Y',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
            credential: 'coach',
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(
      <Routes>
        <Route path="/u/:username" element={<PublicProfile />} />
      </Routes>,
      { route: '/u/coachy' },
    )

    expect(await screen.findByText('Coach Y')).toBeInTheDocument()
    expect(screen.getByText('Coach')).toBeInTheDocument()
  })

  it('renders no badge for a plain member', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/marscheung')) {
        return jsonResponse({
          profile: {
            username: 'marscheung',
            display_name: 'Mars Cheung',
            pronouns: null,
            bio: null,
            location: null,
            avatar_url: null,
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(
      <Routes>
        <Route path="/u/:username" element={<PublicProfile />} />
      </Routes>,
      { route: '/u/marscheung' },
    )

    expect(await screen.findByText('Mars Cheung')).toBeInTheDocument()
    expect(screen.queryByText('Coach')).not.toBeInTheDocument()
  })

  it('shows the not-found page rather than crashing when the username does not exist', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/u/nobody')) {
        return jsonResponse({ message: 'No such user.' }, 404)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(
      <Routes>
        <Route path="/u/:username" element={<PublicProfile />} />
      </Routes>,
      { route: '/u/nobody' },
    )

    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })
})
