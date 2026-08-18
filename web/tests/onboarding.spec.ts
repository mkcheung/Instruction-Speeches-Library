import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { POSTGRES_CONTAINER } from './fixtures';

let email: string;

test.afterEach(() => {
    // Registration is real — it writes an actual row via the running
    // Postgres container. Delete it by email so re-runs don't accumulate
    // test users. This only ever targets rows this test itself created.
    execSync(
        `docker exec ${POSTGRES_CONTAINER} psql -U speechcoach -d speechcoach -c "delete from users where email = '${email}'"`,
    );
});

test('test', async ({ page, context }) => {
    const unique = Date.now();
    email = `onboarding-test-${unique}@example.com`;
    const username = `test${unique}`;

    await page.goto('https://app.speechcoach.test/register');
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
    await page2.getByRole('button', { name: 'View your profile' }).click();

    await expect(page2).toHaveURL(`https://app.speechcoach.test/u/${username}`);
});