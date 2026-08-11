# Step 02 retrospective — Prove the domain layout (locally)

**Executed:** 2026-08-07 · **Against:** [STEP-02-first-deploy.md](STEP-02-first-deploy.md) (rescoped 2026-08-05, commit `26e3e30`, per its own "stakeholder decision" note), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S2 / §5.2 / §5.9
**Method:** solo build, two commits: [`d01618a`](../../commit/d01618a) "Add cross-subdomain TLS layout" and [`8c3cb2d`](../../commit/8c3cb2d) "repair onboarding tests due to domain change," both dated 2026-08-07, landing right after Step 01's identity commit (`fa65c7f`, same day). This retrospective verifies against the live running stack rather than the build session's own account of itself.

---

## What was accomplished

**`docker/nginx/default.conf`** — three `server` blocks added beside Step 00/01's port-80 SPA+API server: `app.speechcoach.test` (TLS-terminated, reverse-proxied to the host's Vite dev server via `host.docker.internal:5173`, with the `Upgrade`/`Connection` pair for HMR's websocket) and `api.speechcoach.test` (TLS-terminated, `fastcgi_pass app:9000` unconditionally, `fastcgi_param HTTPS on` so Laravel's own URL generation knows the request really was HTTPS). Certs are mkcert output, bind-mounted read-only from `docker/certs/` (`compose.yaml`), never baked into the image — `docker/certs/.gitignore` keeps the private key out of git.

**`api/.env.example`** — the full §5.9 config block, all present and matching the step's own list verbatim: `SANCTUM_STATEFUL_DOMAINS=app.speechcoach.test`, `SESSION_DOMAIN=.speechcoach.test` (leading dot), `SESSION_SECURE_COOKIE=true`, `SESSION_COOKIE=speechcoach_session` (pinned, with a comment explaining why — Laravel 13 changed the generated-default format), `CORS_ALLOWED_ORIGINS=https://app.speechcoach.test` (explicit origin, never `*`), `config/cors.php`'s `supports_credentials => true` confirmed by reading the file directly (not assumed from the env example).

**`web/vite.config.ts`** — `server.host: true`, `allowedHosts: ['app.speechcoach.test']` (Vite's DNS-rebinding guard, which would otherwise reject nginx's forwarded `Host` header), and an `hmr` block pointed at `app.speechcoach.test`/`wss`/`443` so the HMR client doesn't try `ws://app.speechcoach.test:5173` and fail.

**`8c3cb2d`** repaired `web/tests/onboarding.spec.ts` and `web/tests/register-validation.spec.ts` for the new `.test` hostnames — both had been written against whatever the pre-Step-02 origin was.

**Verified live against the actual running stack, not asserted from reading config:**
- `/etc/hosts` has both `app.speechcoach.test` and `api.speechcoach.test` pointing at `127.0.0.1`; `docker/certs/` has real mkcert output (`speechcoach.test.pem` / `-key.pem`).
- `curl -sk https://app.speechcoach.test/` → `200`, served by `nginx/1.27.5`; `curl -sk https://api.speechcoach.test/up` → `200`.
- `openssl s_client` against `app.speechcoach.test:443` shows the certificate's issuer is genuinely `mkcert development CA` — a real locally-trusted CA, not a self-signed cert a browser would warn on.
- `GET /sanctum/csrf-cookie` against `api.speechcoach.test` returned both cookies with `domain=.speechcoach.test; secure; samesite=lax`, and `speechcoach_session` additionally `httponly` — every attribute the acceptance list names, read directly off the real `Set-Cookie` headers, not inferred from config.
- Replayed that cookie jar into a real `POST /login` with a deliberately wrong password: got a `422` (validation failure) with the CSRF header round-tripped correctly — **not** a `419` (which is what a broken CSRF round-trip produces), proving the `XSRF-TOKEN` mechanism genuinely works cross-subdomain, from a real request rather than a browser's fetch call.
- Read an actual Mailpit message already sitting in the mailbox (`GET /api/v1/message/…` on `localhost:8025`) from a prior real registration: the verification link is `https://api.speechcoach.test/email/verify/...` — the right host, not `localhost`.
- Ran the real Playwright suite against the live stack: `npx playwright test tests/register-validation.spec.ts tests/onboarding.spec.ts --project=chromium` → **4/4 passed** in a real Chromium instance. `onboarding.spec.ts` in particular is a genuine end-to-end walk — register on `app.speechcoach.test`, open Mailpit in a second tab, click the actual verification link (which opens a third tab on `api.speechcoach.test` and redirects back), complete onboarding, and land on the public profile page — all while carrying the same session cookie across three different `Page` contexts on two different hostnames. This is real evidence of the cross-subdomain cookie mechanism working end-to-end in an actual browser engine, not a curl approximation of one.

---

## Difficulties encountered

1. **The GET/POST path-sharing trap from Step 01 needed a second pass on the `.test` hostnames.** `docker/nginx/default.conf`'s own comments describe re-deriving the `error_page 418 = @backend` idiom (nginx's `if` block cannot contain `fastcgi_pass`) for `/register`, `/login`, `/forgot-password` — the same trap Step 01 hit, now also needing to work through the new TLS-terminating server blocks.
2. **Vite's DNS-rebinding protection (`allowedHosts`) silently rejects a forwarded `Host` header** unless the exact hostname is listed — this is the kind of failure that only surfaces by actually requesting `app.speechcoach.test` through the full nginx→Vite chain, not by reading `vite.config.ts` in isolation.

## Mistakes made

None specific to this step surfaced by the verification above — the config matches the plan's own acceptance list item-for-item, and every item checkable without a GUI browser was independently re-confirmed live rather than trusted from the file contents alone.

## Package/tooling surprises

- **mkcert's issued certificate was confirmed as a genuine locally-trusted CA entry** (`O=mkcert development CA`) via `openssl s_client`, not just assumed from `mkcert -install` having been run at some point — worth having actually checked, since a stale or unregistered root CA would silently produce browser warnings this retrospective would otherwise have missed.
- **Playwright's specs assume a live Postgres container reachable via `docker exec instruction-speeches-library-postgres-1`** for cleanup (`onboarding.spec.ts`'s `afterEach`) — ties the e2e suite to this exact container name/compose project, which is fine locally but is worth knowing before these specs are ever run in CI against a differently-named stack.

## What was not verified — and cannot be, from here

- **"Quit the browser entirely, reopen, still logged in."** Playwright's `context` persists across `Page` objects within one test run but never performs a literal OS-level browser-process restart — that's a different code path (cookie persistence to disk, not just in-memory context) that only a human closing and reopening a real browser actually exercises.
- **The acceptance list's final, load-bearing item — deliberately setting `SESSION_DOMAIN=app.speechcoach.test` (no leading dot), watching auth break, and understanding why.** This is written into the step file as *the point of the whole step*, but it's a one-time educational exercise that leaves no artifact in the repo to check, and re-doing it here would mean editing the live `.env` of the running dev stack and restarting containers — a mutation of shared local state outside this retrospective's scope. Whether this was actually walked through is unverifiable from the repo alone; worth a direct yes/no from whoever ran Step 02, since unlike the other items it can't be recovered from git or a live curl/Playwright check after the fact.
- **Firefox's separate certificate store (`nss`).** The step file flags that Firefox keeps its own trust store independent of the system one mkcert installs into. Verification above only checked the certificate via `openssl` and Chromium (Playwright's `chromium` project); Firefox was not exercised.

---

## Next step

Per [STEPS.md](STEPS.md), Step 02 unblocks [Step 14 — deploy hardening](STEP-14-deploy-hardening.md) far downstream, but the immediately next step in sequence is **[Step 03 — Upload and watch](STEP-03-upload-and-watch.md)**, which does not depend on the two open items above — they're specific to Step 02's own "prove it, then break it on purpose" pedagogy, not blockers for anything built on top. Given the current repo state (verified in this session and the prior [Step 04 retrospective](STEP-04-RETROSPECTIVE.md)), Step 03 and Step 04 are both already built and committed, and Step 05 is in progress uncommitted — so the practical next action is closing the two open items above (the literal browser-restart check and the deliberate `SESSION_DOMAIN` break) as a quick standalone pass, since nothing downstream is waiting on them.

## Next CP checkpoint

Per [LEARNING-TRACK.md](LEARNING-TRACK.md)'s table, **[CP-02 — Deployment, secrets, and environments](CP-02-deployment-and-secrets.md)** is next. It is explicitly optional (Step 03 does not depend on it) and, per its own note and the step file's, "changes shape" with no live host yet — it's meant to be done against a local container over SSH using the separate `speechcoach-deploy-target` repo, not a real provider. This retrospective did not check that separate repo's state or `CP-02-BUILD-PLAN.md`'s phase progress — that's out of scope for a Step 02 grading pass and would need its own look if CP-02 is picked up next.
