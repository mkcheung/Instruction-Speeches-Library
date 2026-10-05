import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { POSTGRES_CONTAINER } from './fixtures.js';

let email: string;

/**
 * `page.goto` defaults to `waitUntil: 'load'`, which never resolves on
 * `/register` behind the Vite dev server — measured here: `load` was still
 * pending at 60s while `domcontentloaded` returned in 638ms and the email
 * field rendered at 970ms. Same failure, same fix, and the same reasoning
 * as `essay-editor.spec.ts`'s own `DOM_READY` docblock (§76-100), which
 * `captions.spec.ts` and `voice-test-helpers.ts` already follow;
 * `onboarding.spec.ts` simply predates the convention.
 *
 * `domcontentloaded` is the correct signal for a SPA anyway: nothing in
 * this walk depends on a window `load` event, and every assertion below
 * waits on a role/text locator rather than on navigation timing.
 */
const DOM_READY = 'domcontentloaded' as const;

test.afterEach(() => {
    // Registration is real — it writes an actual row via the running
    // Postgres container. Delete it by email so re-runs don't accumulate
    // test users. This only ever targets rows this test itself created.
    execSync(
        `docker exec ${POSTGRES_CONTAINER} psql -U speechcoach -d speechcoach -c "delete from users where email = '${email}'"`,
    );
});

test('test', async ({ page, context }) => {
    // Playwright's 30s default covers registration + a Mailpit round-trip +
    // the three onboarding steps; this walk now also follows the redirect
    // to /dashboard and the profile link both ways. Same dev-server
    // transform stalls the auth setup budgets for (see auth.setup.ts), so
    // the budget is raised rather than the assertions loosened.
    test.setTimeout(120_000);

    const unique = Date.now();
    email = `onboarding-test-${unique}@example.com`;
    const username = `test${unique}`;

    await page.goto('https://app.speechcoach.test/register', { waitUntil: DOM_READY });
    await page.getByRole('textbox', { name: 'Email' }).click();
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('textbox', { name: 'Email' }).press('Tab');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass@1234');
    await page.getByRole('textbox', { name: 'Password', exact: true }).press('Tab');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('testpass@1234');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('https://app.speechcoach.test/verify');
    const page1 = await context.newPage();
    await page1.goto('http://localhost:8025/');
    // Clicking the row just opens Mailpit's inline preview (no popup) — the
    // actual verification link is inside that preview's iframe, and IS a
    // real target="_blank" anchor, so clicking it is what opens page2.
    await page1.getByRole('link', { name: `Laravel To: ${email}` }).click();
    const verifyLink = page1
        .frameLocator('iframe')
        .getByRole('link', { name: 'Verify Email Address' });
    const [page2] = await Promise.all([
        page1.waitForEvent('popup'),
        verifyLink.click(),
    ]);
    await page2.getByRole('textbox', { name: 'First name' }).click();
    await page2.getByRole('textbox', { name: 'First name' }).fill('Mars');
    await page2.getByRole('textbox', { name: 'First name' }).press('Tab');
    await page2.getByRole('textbox', { name: 'Last name' }).fill('Cheung');
    await page2.getByRole('textbox', { name: 'Last name' }).press('Tab');
    await page2.getByRole('textbox', { name: 'Username' }).fill(username);
    await page2.getByRole('button', { name: 'Continue' }).click();
    await page2.getByRole('textbox', { name: 'Bio' }).click();
    await page2.getByRole('textbox', { name: 'Bio' }).fill('Testing 123');
    await page2.getByRole('textbox', { name: 'Bio' }).press('Tab');
    await page2.getByRole('textbox', { name: 'Pronouns' }).press('Tab');
    await page2.getByRole('button', { name: 'Continue' }).click();
    await page2.getByRole('button', { name: 'Skip for now' }).click();

    // Finishing step 3 completes onboarding, so the wizard redirects
    // straight to the dashboard — there is no "You're all set" card and no
    // "View your profile" button to click any more.
    //
    // This walk arrives via the verification link, so `?verified=1` is
    // still on the URL and rides through the redirect by design; asserting
    // a bare `/dashboard` would fail on correct behaviour.
    await expect(page2).toHaveURL(/\/dashboard(\?verified=1)?$/);
    await expect(page2.getByText('Email verified.')).toBeVisible();
    await expect(page2.getByRole('heading', { name: 'My reviews' })).toBeVisible();

    // The dashboard is now the only in-app door to the social page, so the
    // walk only proves onboarding finished if that door actually opens.
    await page2.getByRole('link', { name: 'Your profile & connections' }).click();
    await expect(page2).toHaveURL(`https://app.speechcoach.test/u/${username}`);

    // …and back, closing the loop.
    await page2.getByRole('link', { name: 'Back to dashboard' }).click();
    await expect(page2).toHaveURL('https://app.speechcoach.test/dashboard');

    // The sidebar item is the other half of change #2 — it keeps the
    // social page reachable from every authenticated route, not just here.
    // It is keyed off `/api/me`'s username, which is exactly what went
    // stale before `profileApi` learned to invalidate `authApi`'s `Me`.
    await expect(
        page2.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Your profile' }),
    ).toHaveAttribute('href', `/u/${username}`);
});