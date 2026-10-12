import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { renderWithProviders, clearCookies } from '@/test/renderWithProviders'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

/**
 * STEP-12-FROZEN-CONTRACT.md §9: `coach_application.approved`/`.rejected`
 * — `describe()` is a deliberately enumerated `switch`, not
 * generic-fallback-safe (its `default` renders just the bare speech
 * title), so each of these two new types needs its own explicit case,
 * asserted directly here rather than trusting the `default` to be safe.
 */
describe('NotificationBell', () => {
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  function stubNotifications(type: string) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/notifications')) {
        return jsonResponse({
          notifications: [
            {
              id: 'n1',
              type,
              data: { type },
              read_at: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          unread_count: 1,
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it('describes coach_application.approved with its own copy, not the bare-fallback default', async () => {
    stubNotifications('coach_application.approved')
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    await user.click(screen.getByRole('button', { name: /notifications/i }))

    expect(await screen.findByText(/coach application was approved/i)).toBeInTheDocument()
  })

  it('describes coach_application.rejected with its own copy, not the bare-fallback default', async () => {
    stubNotifications('coach_application.rejected')
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell />)

    await user.click(screen.getByRole('button', { name: /notifications/i }))

    expect(await screen.findByText(/coach application was not approved/i)).toBeInTheDocument()
  })

  /**
   * Full-coverage fixture test for the 9 real backend `type` strings, read
   * directly from each `App\Notifications\*::toDatabase()` in api/ (8
   * existing files plus `ReviewPublished`).
   *
   * `describe()`'s `default` case renders EXACTLY the bare speech title
   * and nothing else (see the component), so the proof that a type has
   * its own switch case — rather than silently falling through — is that
   * its rendered row is not that literal string. This must NOT be
   * confused with "the row mentions the title": 4 of the 9 real cases
   * (`coach_application.approved`/`.rejected`, `user.deleted`,
   * `user.suspended`) correctly describe an account/application-level
   * event that has nothing to do with a speech, so their real copy never
   * references `speech_title` at all — that is correct product
   * behaviour, not a missing case. The query below locates the row
   * directly rather than by a name containing the stubbed title, for
   * exactly that reason.
   */
  const ALL_NINE_NOTIFICATION_TYPES = [
    'review.invited', // ReviewInvited.php
    'review.accepted', // ReviewAccepted.php
    'review.declined', // ReviewDeclined.php
    'coach_application.approved', // CoachApplicationApproved.php
    'coach_application.rejected', // CoachApplicationRejected.php
    'user.deleted', // AccountDeleted.php
    'user.suspended', // AccountSuspended.php
    'speech.taken_down', // SpeechTakenDown.php
    'review.published', // ReviewPublished.php (spec string; file may not exist yet)
  ] as const

  const BARE_FALLBACK_TITLE = 'Test Speech Title'

  function stubNotificationWithTitle(type: string) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      if (url.endsWith('/api/notifications')) {
        return jsonResponse({
          notifications: [
            {
              id: 'n1',
              type,
              data: { type, speech_title: BARE_FALLBACK_TITLE, actor_name: 'Alex' },
              read_at: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          unread_count: 1,
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  it.each(ALL_NINE_NOTIFICATION_TYPES)(
    'describes notification type %s with more than the bare fallback title',
    async (type) => {
      stubNotificationWithTitle(type)
      const user = userEvent.setup()
      renderWithProviders(<NotificationBell />)

      await user.click(screen.getByRole('button', { name: /notifications/i }))

      // Query the one stubbed row directly, not by a name containing the
      // fake title: 4 of the 9 real cases (coach_application.approved/
      // .rejected, user.deleted, user.suspended) correctly describe an
      // account/application-level event that has nothing to do with a
      // speech at all, so their copy never mentions `speech_title` — that
      // is correct product behaviour, not a fallthrough to `default`.
      // `default` renders EXACTLY `speech_title` and nothing else, so the
      // one popup's only button not being that literal string is still
      // the right proof that this type didn't fall through.
      const dialog = await screen.findByRole('dialog')
      const item = within(dialog).getByRole('button')
      expect(item.textContent).not.toBe(BARE_FALLBACK_TITLE)
    },
  )
})
