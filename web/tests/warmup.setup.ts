import { test as warmup } from '@playwright/test'
import { APP_URL, SHARED_SPEECH_ID } from './fixtures.js'

/**
 * WHY THIS EXISTS — and why deleting it brings back a 30-second flake.
 *
 * `docker/nginx/default.conf` proxies app.speechcoach.test to the HOST's
 * Vite DEV server (host.docker.internal:5173), so these specs drive dev
 * mode, not the built bundle: the served HTML carries `/@vite/client` and
 * unbundled `/src/main.tsx`.
 *
 * In dev, one cold page load asks for hundreds of individual modules and
 * Vite transforms them on demand, single-threaded. Chromium requests them
 * in parallel, the dev server saturates, and page loads intermittently
 * stall for ~30s — long enough to blow the default test timeout. Measured,
 * not guessed: during a stall a plain `curl` to /login (no browser
 * involved) also took 35.9s, while the same request took 0.02s moments
 * before and after, and the API container answered in 50ms throughout.
 * The flake follows the dev server's module-graph cache, which is why it
 * hits the first run after an idle period and vanishes on an immediate
 * re-run.
 *
 * This project runs before `setup` (which runs before the specs) and pays
 * that transform cost once, deliberately, with a timeout that expects it.
 *
 * THE REAL FIX is to point E2E at the production build instead of the dev
 * server — test the artifact you ship. That's a change to the nginx vhost
 * and the dev workflow, so it is deliberately NOT done here.
 */
warmup('warm the Vite dev server module graph', async ({ page }) => {
  warmup.setTimeout(180_000)

  // Every route the specs actually navigate to, so each module graph is
  // transformed and cached before anything is being timed.
  await page.goto(`${APP_URL}/login`, { timeout: 120_000, waitUntil: 'load' })
  await page.goto(`${APP_URL}/speeches/${SHARED_SPEECH_ID}`, {
    timeout: 120_000,
    waitUntil: 'load',
  })
})
