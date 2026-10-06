import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSentry } from './lib/sentry'

// Must run before the first render — Sentry.init() installs its global
// handlers (window.onerror, unhandledrejection) that an error boundary
// alone doesn't cover, and does nothing at all when no DSN is configured
// (see lib/sentry.ts).
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
