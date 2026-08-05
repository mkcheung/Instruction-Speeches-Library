# Step 02 — First deploy, thin

**Duration:** 0.5–1 week · **Depends on:** [01](STEP-01-identity.md) · **Unblocks:** [14](STEP-14-deploy-hardening.md)
**Plan:** [§12 S2](MODERNIZATION_PLAN.md) · [§5.2 decoupled SPA](MODERNIZATION_PLAN.md) · [§5.9 auth config](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Register and log in **on a real domain over TLS**, refresh the page, and still be logged in.

### Demo script

1. Push a commit to `main`. Watch CI deploy it, unattended, and run migrations.
2. Open `https://app.yourdomain.com` on your phone. Register.
3. **Check a real Gmail inbox.** The verification mail is there — in the inbox, not spam.
4. Log in. **Hard-refresh.** Still logged in.
5. Quit the browser entirely. Reopen. Still logged in.

## Why this step exists — read this before deciding to skip it

**This is the highest-leverage reorder in the whole plan, and it has nothing to do with demos.**

§5.2 states the trap precisely: `localhost:5173` and `localhost:8000` **share the registrable domain `localhost`**. So Sanctum cookie auth works perfectly on your laptop *even when the production layout is wrong* — and you find out at deploy.

Revision 4 scheduled that discovery for week 24, on top of twenty-four weeks of accumulated infrastructure. Doing it here costs half a week and answers [§20 Q5](MODERNIZATION_PLAN.md) **by observation instead of by argument**.

If the answer is bad — the SPA must live on a different registrable domain — §5.9 already has the fix (a Sanctum **personal access token**, not JWT), and applying it to two screens is a day. Applying it to the whole product in week 24 is not.

## Backend

The smallest thing that can hold step 01:

- Application host, database, TLS.
- DNS for `app.` and `api.` **on one registrable domain**.
- **A real mail provider with SPF/DKIM/DMARC — not Mailpit.** R13 makes deliverability load-bearing: a verification mail in spam is an account that never activates.
- Secrets management.
- CD from `main` with migrations.

⚠️ **Do not run migrations from the container entrypoint** (§21.5). It works with one container and races with two. Run them as a separate one-shot step in the pipeline, before the new containers serve traffic.

## Frontend

Nothing new. The build output is the deliverable.

## Deliberately stubbed

**One environment, not staging *and* production.** No backups, no monitoring, no queue workers (nothing is queued yet), no object-storage lifecycle rules, no CDN. The `media` bucket exists and is empty.

This is a **skeleton deploy**. [Step 14](STEP-14-deploy-hardening.md) makes it a production one.

## Containers introduced

None. The compose file becomes **environment-parameterized** rather than gaining services — which is the lesson: dev/prod parity is about the same file behaving differently, not a different file.

## Acceptance

- [ ] A commit to `main` reaches the live host automatically and runs migrations
- [ ] Registration and login work **against the real cookie domain layout**
- [ ] The session survives a hard refresh **and a browser restart**
- [ ] A verification email lands in a real Gmail **inbox**, not spam
- [ ] §20 Q5 is closed — **in writing**, with the actual domain layout recorded

## Watch for

- `config/cors.php` ships `supports_credentials => false`. This is the single most common cause of "Sanctum doesn't work" (§5.9).
- `allowed_origins` **must name the origin** — the CORS spec forbids `*` on a credentialed request and every browser rejects it.
- `SESSION_DOMAIN=.yourdomain.com` (leading dot) is the one line that makes cross-subdomain work. The `XSRF-TOKEN` cookie inherits from the same config.

---

## 🎓 Optional next: [CP-02](CP-02-deployment-and-secrets.md)

| | |
|---|---|
| **Learn** | Deployment, secrets and environments |
| **Track** | CD |
| **Time** | ~4h |

**This is optional.** [Step 03](STEP-03-upload-and-watch.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
