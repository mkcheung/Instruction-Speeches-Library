import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

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
        `docker exec instruction-speeches-library-postgres-1 psql -U speechcoach -d speechcoach -c "delete from speeches where user_id = (select id from users where email = '${email}'); delete from users where email = '${email}'"`,
    );
});

test('creating a speech record surfaces the upload step', async ({ page }) => {
    const unique = Date.now();
    email = `speech-create-test-${unique}@example.com`;
    const username = `test${unique}`;

    await page.goto('https://app.speechcoach.test/register');
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
    await onboarding.getByRole('button', { name: /skip|continue/i }).click();

    await onboarding.goto('https://app.speechcoach.test/speeches/new');
    await onboarding.getByLabel('Title').fill('My first speech');
    await onboarding.getByRole('button', { name: 'Continue to upload' }).click();

    await expect(onboarding.getByText(/upload "my first speech"/i)).toBeVisible();
});
