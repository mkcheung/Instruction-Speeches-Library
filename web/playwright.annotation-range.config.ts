import { defineConfig, devices } from '@playwright/test'

const database = process.env.ANNOTATION_RANGE_DATABASE ?? ''
if (!/^annotation_range_browser_[a-z0-9_]+$/.test(database)) throw new Error('Set ANNOTATION_RANGE_DATABASE to a freshly prepared isolated browser database.')
export default defineConfig({
  testDir: './tests/annotation-range',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: './test-results/annotation-range',
  use: { baseURL: 'http://127.0.0.1:5180', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [{
    command: 'php -S 127.0.0.1:8180 ../scripts/serve-annotation-range-browser.php',
    cwd: '../api', url: 'http://127.0.0.1:8180/up', reuseExistingServer: false, timeout: 30_000,
    env: { APP_ENV: 'testing', APP_URL: 'http://127.0.0.1:8180', FRONTEND_URL: 'http://127.0.0.1:5180',
      CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5180', SANCTUM_STATEFUL_DOMAINS: '127.0.0.1:5180',
      DB_CONNECTION: 'pgsql', DB_HOST: '127.0.0.1', DB_PORT: '5433', DB_DATABASE: database, DB_URL: '',
      CACHE_STORE: 'array', QUEUE_CONNECTION: 'database', SESSION_DRIVER: 'database', SESSION_DOMAIN: '127.0.0.1',
      SESSION_COOKIE: 'annotation_range_test_session', SESSION_SECURE_COOKIE: 'false', MAIL_MAILER: 'array' },
  }, {
    command: 'npm run dev -- --config vite.annotation-range.config.ts', url: 'http://127.0.0.1:5180', reuseExistingServer: false,
    env: { VITE_API_URL: 'http://127.0.0.1:8180' },
  }],
})
