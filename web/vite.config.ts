/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // STEP-02-first-deploy.md: nginx's `web` container reverse-proxies
    // https://app.speechcoach.test to this dev server over the docker
    // network (host.docker.internal), not 127.0.0.1 — must listen on all
    // interfaces or that connection is refused.
    host: true,
    port: 5173,
    strictPort: true,
    // Vite validates the incoming Host header against this list (DNS
    // rebinding protection) — without it, nginx forwarding
    // `Host: app.speechcoach.test` gets "Blocked request. This host is not
    // allowed."
    allowedHosts: ['app.speechcoach.test'],
    hmr: {
      // The browser's websocket connects to app.speechcoach.test:443
      // (nginx, TLS) — not directly to this dev server on :5173 plain HTTP —
      // so the HMR client needs to be told that explicitly, or it tries to
      // open ws://app.speechcoach.test:5173 and fails.
      host: 'app.speechcoach.test',
      protocol: 'wss',
      clientPort: 443,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's default glob also matches web/tests/*.spec.ts, which are
    // Playwright specs (their own test()/describe(), run via `playwright
    // test`, not vitest) — without this exclude, vitest tries to execute
    // them itself and fails with "did not expect test() to be called here."
    exclude: ['tests/**', 'node_modules/**'],
  },
})
