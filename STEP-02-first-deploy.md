# Step 02 — Prove the domain layout (locally)

**Duration:** 0.5 week · **Depends on:** [01](STEP-01-identity.md) · **Unblocks:** [14](STEP-14-deploy-hardening.md)
**Plan:** [§12 S2](MODERNIZATION_PLAN.md) · [§5.2 decoupled SPA](MODERNIZATION_PLAN.md) · [§5.9 auth config](MODERNIZATION_PLAN.md)

> **⚠️ Scope changed — stakeholder decision, 2026-08-05.**
> No registrable domain yet; the project runs locally and moves to a live host later.
>
> **This step splits in two.** The half that matters most — proving the cookie-domain layout — **is fully doable locally** and stays here. The half that needs a server (CD, secrets, provisioning, real mail) moves to [Step 14](STEP-14-deploy-hardening.md). See [Why this still works](#why-this-still-works) below.

## ✅ What you can do when this is finished

> Register and log in at `https://app.speechcoach.test`, with the API on a **different subdomain**, over **real HTTPS** — refresh, restart the browser, and still be logged in.

### Demo script

1. Open `https://app.speechcoach.test`. **Note the padlock** — locally-trusted TLS, not an exception you clicked through.
2. Register. The API is at `https://api.speechcoach.test` — **a different host**, sharing the registrable domain.
3. Open devtools → Application → Cookies. **The session cookie's Domain is `.speechcoach.test`**, `Secure`, `HttpOnly`, `SameSite=Lax`. That is the production configuration, running on your laptop.
4. Log in. **Hard-refresh.** Still logged in.
5. **Quit the browser entirely. Reopen.** Still logged in.
6. Check Mailpit — the verification mail arrived, and the link points at the right host.

<a id="why-this-still-works"></a>
## Why this still works without buying a domain

§5.2 states the trap precisely: `localhost:5173` and `localhost:8000` **share the registrable domain `localhost`**, so Sanctum cookie auth works on your laptop *even when the production layout is wrong* — and you find out at deploy.

**But the trap is about domain *structure*, not about DNS being public.** All the mechanics need is two hostnames sharing a registrable domain, and `/etc/hosts` provides that for nothing:

```
127.0.0.1  app.speechcoach.test
127.0.0.1  api.speechcoach.test
```

`speechcoach.test` is the registrable domain. `app.` and `api.` are subdomains of it. `SESSION_DOMAIN=.speechcoach.test` therefore exercises **exactly the code path production will use**.

`.test` is a reserved TLD (RFC 6761) that will never be sold, so it can't collide with anything real. Laravel Valet has used this pattern for years.

> **What this genuinely proves:** the cookie domain, the CORS origin allow-list, `supports_credentials`, the CSRF cookie round-trip, `SameSite` behaviour under HTTPS, and the Sanctum stateful-domain config. **That is the substance of §20 Q5**, and it's the part that would have been expensive to discover late.
>
> **What it does not prove:** real DNS, a public CA, server provisioning, CD, secret management, and email deliverability. Those move to [Step 14](STEP-14-deploy-hardening.md) — and they're the parts that fail *loudly and immediately* when wrong, rather than silently for six months.

## Backend

- **`/etc/hosts` entries** for `app.` and `api.` on a shared `.test` domain.
- **`mkcert`** for locally-trusted certificates — a real CA in your system trust store, so the browser shows a genuine padlock.

  ⚠️ **TLS is not optional here.** `SESSION_SECURE_COOKIE=true` is the production setting, and a `Secure` cookie is not stored over plain HTTP. Testing without TLS means testing a *different* configuration and hiding the problem you came for.
- **nginx in the `web` container** terminating TLS and routing both hostnames.
- The full §5.9 config against these hostnames:
  - `SANCTUM_STATEFUL_DOMAINS=app.speechcoach.test`
  - `SESSION_DOMAIN=.speechcoach.test` ← the leading dot is the whole thing
  - `SESSION_SECURE_COOKIE=true`
  - `SESSION_COOKIE` **pinned** explicitly
  - `cors.allowed_origins` naming the origin — **never `*`**, which the CORS spec forbids on credentialed requests
  - `cors.supports_credentials=true` — ships `false`, and is the usual cause of "Sanctum doesn't work"

## Frontend

Nothing new. `VITE_API_URL` points at `https://api.speechcoach.test`, and the Vite dev server serves `app.speechcoach.test` over the mkcert certificate.

## Deliberately deferred to [Step 14](STEP-14-deploy-hardening.md)

Not skipped — **relocated**, with the reason:

| Deferred | Why it's safe to defer |
|---|---|
| Server provisioning | No server yet, by your decision |
| CD from `main` | Nothing to deploy to. The workflow is written at [CP-02](CP-02-deployment-and-secrets.md) against a local target |
| Production secrets | Same |
| **Real email deliverability** (R13) | Mailpit covers the flow; **deliverability is a separate risk that only a real provider tests** |
| Public CA / real DNS | mkcert proves the TLS *config*; a public CA proves nothing extra about your app |

## Acceptance

- [ ] The app is served at `https://app.speechcoach.test` with a **real padlock**, not a clicked-through warning
- [ ] The API is on `https://api.speechcoach.test` — **a different hostname**
- [ ] Registration and login work **cross-subdomain with `SESSION_SECURE_COOKIE=true`**
- [ ] The session cookie shows `Domain=.speechcoach.test`, `Secure`, `HttpOnly`, `SameSite=Lax` in devtools
- [ ] The session survives a hard refresh **and a full browser restart**
- [ ] A CSRF-protected write succeeds — proving the `XSRF-TOKEN` round-trip works cross-subdomain
- [ ] `SESSION_COOKIE` is pinned, not generated
- [ ] **Deliberately break it once:** set `SESSION_DOMAIN=app.speechcoach.test` (no leading dot), watch auth fail, and understand why

That last one is the point of the whole step. **A configuration you've only seen work teaches you less than one you've seen fail.**

## Watch for

⚠️ **`.test` must not be caught by a DNS-over-HTTPS resolver or a corporate VPN** that intercepts unknown TLDs. If `app.speechcoach.test` doesn't resolve to 127.0.0.1, check that first.

⚠️ **mkcert's root CA must be installed in the *system* trust store** (`mkcert -install`), and Firefox keeps its own store — it needs `nss` installed to pick it up.

⚠️ **Docker networking:** the containers must reach each other by service name while the browser reaches them by `.test` hostname. Those are different addresses for the same service, and the mismatch is a classic hour lost. The API's own knowledge of its public URL (`APP_URL`) must be the `.test` one, because that's what ends up in verification email links.

**The residual risk you're accepting:** deployment *mechanics* — provisioning, CD, secrets — are still discovered later. That risk is real but much smaller than the cookie one, because those fail immediately and visibly rather than silently. Written down here so it isn't a surprise at Step 14.

---

## 🎓 Optional next: [CP-02](CP-02-deployment-and-secrets.md)

| | |
|---|---|
| **Learn** | Deployment, secrets and environments |
| **Track** | CD |
| **Time** | ~4h |

**This is optional.** [Step 03](STEP-03-upload-and-watch.md) does not depend on it — go straight on if you'd rather.

⚠️ **With no live host, CP-02 changes shape too.** You can still learn the whole of it by deploying to a **local container over SSH** — that exercises secrets, `needs:`, `concurrency`, SSH host keys and rollback identically. The only thing you can't practise is a real provider's quirks. See the note at the top of that checkpoint.
