import * as Sentry from '@sentry/react'

/**
 * STEP-14-deploy-hardening.md: GlitchTip is a self-hosted, MIT-licensed,
 * Sentry-wire-protocol-compatible error tracker — the real `@sentry/react`
 * SDK works against it unmodified; only the DSN differs from a real
 * Sentry.io project.
 *
 * Same optional-by-default shape as `VITE_ENABLE_SPIKES`
 * (`spikes-guard.ts`): nobody running this app without a GlitchTip
 * instance configured — which is every local-dev setup until someone
 * opts in — should see Sentry do anything. An empty/unset DSN is a
 * deliberate, silent no-op, not a thrown configuration error, so this is
 * safe to call unconditionally from `main.tsx`.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_GLITCHTIP_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    // GlitchTip doesn't implement Sentry's newer session-replay/tracing
    // products (STEP-14 scope is error reporting only) — no integrations
    // beyond the defaults needed here.
    integrations: [],
  })
}
