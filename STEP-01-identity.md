# Step 01 — Account and identity

**Duration:** 2–2.5 weeks · **Depends on:** [00](STEP-00-foundation.md) · **Unblocks:** [02](STEP-02-first-deploy.md), [03](STEP-03-upload-and-watch.md), [05](STEP-05-invitation-loop.md)
**Plan:** [§12 S1](MODERNIZATION_PLAN.md) · [§6.5 profiles and onboarding](MODERNIZATION_PLAN.md) · [§5.9 auth](MODERNIZATION_PLAN.md) · [§7 roles](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Register, receive a verification email, click the link **on your phone**, complete a three-step profile with an avatar, log in, and visit `/u/yourname`.

### Demo script

1. Register with a real email address.
2. Open Mailpit — the verification mail is there. **Click the link on a different device.** It works rather than 500ing.
3. Complete onboarding: names, username, bio, avatar. **Close the tab halfway through.** Come back tomorrow — you resume at step 2, not step 1.
4. Log in. Visit `/u/yourname`. Your face and bio are there.
5. Try to register a second account as `MarsCheung` when `marscheung` exists. **Refused, with a message that explains why** — not a 500.
6. Upload a photo with GPS EXIF. Download it back from storage. **The GPS block is gone.**

## Backend

- `users`, `profiles`, `username_history`, Spatie's role migrations, four roles seeded (`super_admin`, `admin`, `coach`, `member`).
- Fortify with **every JSON response contract hand-bound** — headless Fortify does not ship them.
- Sanctum stateful, CORS with credentials, CSRF bootstrap.
- Avatar upload with **EXIF stripping and re-encoding** — never trust the input container.
- Resumable onboarding writing to `profiles` at each step.
- `preventLazyLoading` from the first model.
- `E2ESeeder` with fixed ids and **literal timestamps, never `now()`** — it grows in every later step and is what makes seeded scaffolds trustworthy.

## Frontend

- Auth shell with route-middleware guards; register / verify / login / forgot-password.
- The multi-step **resumable** onboarding form with an avatar cropper.
- Own-profile edit; the public `/u/{username}`.
- **The single `422` error contract wired into `react-hook-form`'s `setError`** — build it here or every later form re-invents it.
- The **419-is-not-401** single-flight retry (§5.9). Conflating them produces a logout loop every time the XSRF cookie expires.

## Deliberately stubbed

Roles assigned by `php artisan user:grant-role {user} {role}` — no admin UI until step 12. Notifications are the verification mail only. `QUEUE_CONNECTION=sync`. The public profile shows identity only — no timeline, no connections rail.

## Containers introduced

`mailpit`. **Teaches:** a container that exists purely to intercept something, and how `MAIL_HOST=mailpit` just works over the compose network.

## Shape decisions locked here (§12.1)

Not migrations — decisions. They cost nothing now and everything later:

- Speech ownership is **immutable**
- The review **is** the access grant
- `annotations.review_id` is **NOT NULL**
- `reviews` have **no soft delete**
- **ULID public identifiers** over bigint PKs
- **Fractional-second** timestamps, never `TIME`
- The essay lives on `reviews`

## Acceptance

- [ ] All four roles register, verify, onboard and log in; **session id regenerates**
- [ ] ⚠️ **`fortify.limiters.login` is explicitly set and a throttle test proves it** — the stub ships `null`, so the rate limiting you think you configured is **inert** (§5.9)
- [ ] **The cross-device email-verification link works** rather than 500ing — needs a `login` *named route* to exist
- [ ] Case- and accent-variant usernames collide and the second registration is refused with a usable message
- [ ] The reserved-username list rejects `admin` and every top-level SPA route, and **is data rather than a constant**
- [ ] A JPEG with GPS EXIF is re-encoded and the stored file, read back, **has no GPS block**
- [ ] `SESSION_COOKIE` is **pinned** — Laravel 13 changed the generated default, and relying on it means a framework upgrade logs out every user
- [ ] `PreventRequestForgery` keeps both defaults `false` (`originOnly`, `allowSameSite`)

## Watch for

⚠️ **PostgreSQL is case-sensitive**, unlike the MySQL collation this plan originally assumed. §5.8a flags this as the one place the old engine was doing real work for free: `MarsCheung` / `marscheung` / `märscheung` must still collide, so **normalize case *and* accents on write.** Budget half a day; make the collision an acceptance test.

---

## 🎓 Optional next: [CP-01](CP-01-codegen-then-refactor.md)

| | |
|---|---|
| **Learn** | **Codegen, then refactor** — the core lesson of the whole track |
| **Track** | Playwright |
| **Time** | ~4h |

**This is optional.** [Step 02](STEP-02-first-deploy.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
