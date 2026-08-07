import { test, expect } from '@playwright/test';

/**
 * Register's client-side validation (web/src/lib/validation.ts's
 * registerSchema) never hits the backend — these assert the exact field
 * error and that submission is blocked, staying on /register.
 */
test.describe('register validation', () => {
  test('rejects an invalid email', async ({ page }) => {
    await page.goto('http://localhost:5173/register');
    await page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass@1234');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('testpass@1234');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Enter a valid email.')).toBeVisible();
    await expect(page).toHaveURL('http://localhost:5173/register');
  });

  test('rejects a password under 8 characters', async ({ page }) => {
    await page.goto('http://localhost:5173/register');
    await page.getByRole('textbox', { name: 'Email' }).fill('onboarding-validation@example.com');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('short');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
    await expect(page).toHaveURL('http://localhost:5173/register');
  });

  test('rejects a mismatched confirmation', async ({ page }) => {
    await page.goto('http://localhost:5173/register');
    await page.getByRole('textbox', { name: 'Email' }).fill('onboarding-validation@example.com');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('testpass@1234');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('somethingelse123');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await expect(page).toHaveURL('http://localhost:5173/register');
  });
});
