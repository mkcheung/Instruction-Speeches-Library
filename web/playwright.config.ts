import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* The real-stack e2e specs (tests/speech-create.spec.ts etc.) hit
     * https://app.speechcoach.test / api.speechcoach.test over TLS from a
     * cert `mkcert` generates fresh in CI. Its local CA is never imported
     * into a trust store there (no NSS/certutil dance needed) — this is
     * the deliberate tradeoff instead: the cert is genuinely self-signed
     * from Chromium's point of view, and that's fine, since what these
     * tests are proving is app behavior, not certificate trust chains. */
    ignoreHTTPSErrors: true,

    /* STEP-09-VERIFICATION-PLAN.md §7 item 10 / §5: 'screenshot: only-on-
     * failure' and 'video: retain-on-failure', kept alongside the existing
     * 'trace: on-first-retry' — CI (.github/workflows/ci.yml) uploads
     * web/test-results/ (which is where these land) as artifacts on every
     * run, `if: always()`, so a captions.spec.ts failure is diagnosable
     * without reproducing it locally first. */
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    /* CP-05: the setup-PROJECT pattern, which replaced `globalSetup` as
     * the documented way to do this. It logs each fixture role in once and
     * saves the session cookies to playwright/.auth/*.json; every browser
     * project below depends on it, so the auth files are regenerated on
     * every run rather than committed (they are live session cookies —
     * playwright/.auth/ is gitignored, and must stay that way). */
    /* Ordered ahead of `setup` because these specs run against the Vite
     * DEV server (see warmup.setup.ts for the measured reason). */
    { name: 'warmup', testMatch: /warmup\.setup\.ts/ },

    { name: 'setup', testMatch: /auth\.setup\.ts/, dependencies: ['warmup'] },

    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The dedicated stack is always bound on loopback. Keep Chromium's
        // media element on that deterministic route even on macOS hosts
        // where the system DNS cache can lag a newly-added /etc/hosts row.
        // This changes name resolution only; HTTPS, SigV4, Range, codecs,
        // API authorization, SeaweedFS, and the bytes themselves stay real.
        launchOptions: {
          args: ['--host-resolver-rules=MAP app.speechcoach.test 127.0.0.1, MAP api.speechcoach.test 127.0.0.1, MAP media.speechcoach.test 127.0.0.1'],
        },
      },
      dependencies: ['setup'],
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },

    {
      // Regression coverage only. This emulated viewport/Playwright WebKit
      // project is intentionally never described as physical iPhone Safari
      // evidence; STEP-10's manual device ledger remains separate.
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
