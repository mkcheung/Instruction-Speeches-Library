import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import Onboarding from '@/routes/Onboarding'
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

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    email: 'mars@example.com',
    first_name: null,
    last_name: null,
    username: null,
    email_verified: true,
    roles: ['member'],
    onboarding_completed: false,
    onboarding_step: 1,
    ...overrides,
  }
}

/**
 * §6.5's resumability requirement: onboarding writes to the backend on
 * every step, and the route asks "which step am I on" (`GET
 * /api/onboarding`, `App\Support\Onboarding::currentStep`) rather than
 * always starting at step 1. This proves the frontend half of that
 * contract — given a status response reporting step 1 already complete,
 * it renders step 2's form (bio/pronouns/location), not step 1's
 * (name/username).
 */
describe('Onboarding resumability', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resumes at step 2 when the backend reports step 1 already complete', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({
          step: 2,
          user: baseUser({
            first_name: 'Mars',
            last_name: 'Cheung',
            username: 'marscheung',
            onboarding_step: 2,
          }),
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<Onboarding />, { route: '/onboarding' })

    expect(await screen.findByText('About you')).toBeInTheDocument()
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/bio/i)).toBeInTheDocument()
  })

  it('starts at step 1 for a brand new, empty profile', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({ step: 1, user: baseUser() })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<Onboarding />, { route: '/onboarding' })

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
  })

  it('shows a link to the finished profile once step 4 (done) is reached', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/api/onboarding')) {
        return jsonResponse({
          step: 4,
          user: baseUser({
            first_name: 'Mars',
            last_name: 'Cheung',
            username: 'marscheung',
            onboarding_completed: true,
            onboarding_step: 4,
          }),
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<Onboarding />, { route: '/onboarding' })

    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view your profile/i })).toBeInTheDocument()
  })
})
