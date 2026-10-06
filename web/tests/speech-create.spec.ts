import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { POSTGRES_CONTAINER } from './fixtures.js';

/**
 * STEP-03-upload-and-watch.md's demo script covers far more than this file
 * does: kill-wifi-mid-upload-and-resume, cross-browser scrub, a second
 * Member's direct presigned-URL fetch failing, and an unmodified iPhone
 * .MOV failing visibly. None of those are exercised here — they need a
 * real compliant video fixture (this repo has none committed; the S0 spike
 * wall's `spikes/sample.mp4` was a local, ungitted file) and, for the
 * wifi/cross-user cases, either real network manipulation or a second
 * authenticated browser context. Follow STEP-03's own demo script by hand
 * against the live stack for full coverage; this spec only proves the
 * create-a-speech-record step, which needs neither.
 *
 * Not run as part of this change — written against the same conventions as
 * tests/onboarding.spec.ts, but unverified against a live backend.
 */

let email: string;

test.afterEach(() => {
    // `speeches.user_id` is `ON DELETE RESTRICT` (§6.3 — deliberate: a
    // speech outliving its speaker's account deletion is a real product
    // decision, not something to cascade away by accident). This test
    // creates a speech, so deleting straight from `users` is now blocked
    // by the FK it used to never touch — delete the dependent `speeches`
    // row(s) first (their `speech_assets` cascade automatically) and only
    // then the user.
    execSync(
        `docker exec ${POSTGRES_CONTAINER} psql -U speechcoach -d speechcoach -c "delete from speeches where user_id = (select id from users where email = '${email}'); delete from users where email = '${email}'"`,
    );
});

/**
 * Same `waitUntil` note as `onboarding.spec.ts`: `page.goto`'s default
 * `load` does not resolve on `/register` behind the Vite dev server
 * (observed locally as both a 30s stall and `net::ERR_ABORTED; maybe frame
 * was detached?`), while `domcontentloaded` returns in well under a second.
 * CI serves the built bundle through `scripts/e2e-stack.sh` rather than the
 * dev server, so this mattered only for local runs — which is exactly where
 * it blocked verifying changes to this file.
 */
const DOM_READY = 'domcontentloaded' as const;

test('creating a speech record surfaces the upload step', async ({ page }) => {
    // Registration + a Mailpit round-trip + three onboarding steps + the
    // redirect + the upload step do not fit Playwright's 30s default on a
    // loaded dev server. Same budget and same reasoning as
    // `onboarding.spec.ts`.
    test.setTimeout(120_000);

    const unique = Date.now();
    email = `speech-create-test-${unique}@example.com`;
    const username = `test${unique}`;

    await page.goto('https://app.speechcoach.test/register', { waitUntil: DOM_READY });
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass@1234');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('testpass@1234');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('https://app.speechcoach.test/verify');

    const inbox = await page.context().newPage();
    await inbox.goto('http://localhost:8025/');
    await inbox.getByRole('link', { name: `Laravel To: ${email}` }).click();
    const verifyLink = inbox.frameLocator('iframe').getByRole('link', { name: 'Verify Email Address' });
    const [onboarding] = await Promise.all([inbox.waitForEvent('popup'), verifyLink.click()]);

    await onboarding.getByRole('textbox', { name: 'First name' }).fill('Mars');
    await onboarding.getByRole('textbox', { name: 'Last name' }).fill('Cheung');
    await onboarding.getByRole('textbox', { name: 'Username' }).fill(username);
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await onboarding.getByRole('textbox', { name: 'Bio' }).fill('Testing 123');
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    // Exact name, never /skip|continue/i: that regex also matches step 2's
    // own "Continue" button, which is still mounted and enabled in the
    // window after its mutation resolves (`isLoading` false, label back to
    // "Continue") but before the invalidated `getOnboardingStatus` refetch
    // swaps in step 3. Matching loosely clicks step 2 a second time, step 3
    // is never skipped, and the waitForURL below burns the full timeout.
    // `onboarding.spec.ts` walks the same flow and always used the exact
    // name — which is why it never caught this.
    await onboarding.getByRole('button', { name: 'Skip for now' }).click();

    // Completing step 3 redirects to /dashboard. Waiting for it before the
    // goto below keeps the two navigations from racing — this test only
    // cares that onboarding finished, not where it lands.
    //
    // Matched as a pattern, not an exact string: this walk arrives via the
    // verification link, so `?verified=1` rides through the redirect and an
    // exact `/dashboard` would never match.
    await onboarding.waitForURL(/\/dashboard(\?verified=1)?$/, { waitUntil: DOM_READY });

    await onboarding.goto('https://app.speechcoach.test/speeches/new', { waitUntil: DOM_READY });
    await onboarding.getByLabel('Title').fill('My first speech');
    await onboarding.getByRole('button', { name: 'Continue to upload' }).click();

    await expect(onboarding.getByText(/upload "my first speech"/i)).toBeVisible();
});
