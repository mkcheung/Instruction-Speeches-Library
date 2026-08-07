# Step 00 retrospective — Foundation and the spike wall

**Executed:** 2026-08-06 · **Against:** [STEP-00-foundation.md](STEP-00-foundation.md), [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) §12 S0 / §21 / §8.2 / §9.3 / §10.5
**Method:** two background subagents (backend, frontend) scaffolding in parallel, plus direct work on Docker infra, integration, and verification.

---

## What was accomplished

**`api/` — Laravel 13.24.0**, scaffolded at the repo root beside `legacy/`:
- `GET /api/health` — JSON health check, reachable cross-origin with credentials (`config/cors.php`, `supports_credentials=true`, explicit origin allowlist).
- `App\Services\MediaUrlSigner::presign()` — the one place application code is allowed to construct a media URL (§9.4 rule 1), backed by `Storage::disk('media_public')->temporaryUrl()`. `GET /api/spikes/presign?path=...` exposes it.
- `config/filesystems.php` gained **two** S3-driver disks pointed at SeaweedFS: `media` (internal, `seaweedfs:8333`, used for all in-container file operations) and `media_public` (browser-facing, `localhost:8333`, used only for signing — see "Mistakes," below).
- Pint, Larastan (v3.10 — see below), Pest, all green. 6 tests, 18 assertions.

**`web/` — Vite + React 19.2.8 + TypeScript**, scaffolded beside `api/`:
- Tailwind 4 + shadcn with design tokens; ESLint flat config; Vitest.
- `/__spikes`, gated by a double guard (`import.meta.env.DEV && VITE_ENABLE_SPIKES === 'true'`, checked both at route-registration time and at render time), 404ing rather than 403ing when either fails.
- Three panels: credentialed health fetch; a `<video>` fed by the presign endpoint with a scrub harness; and a cue-timing instrumentation panel.
- `src/lib/engine.ts` — `normalize`, `computeActive`, `timingSignature`, copied faithfully from §8.2. 31 Vitest cases covering boundaries, overlaps, zero/negative/NaN/Infinity durations and starts, per §19's explicit demand for exhaustive `computeActive` coverage.
- `tsc -b`, `eslint .`, `vitest run`, `npm run build` all green.

**Docker infrastructure** — hand-written, not Sail, per §21:
- `Dockerfile`: `vendor` (Composer) → `webbuild` (Vite production build) → `runtime` (php-fpm) → `nginx` stages, with the caching discipline §21.5 specifies (manifests copied and installed before source).
- `compose.yaml`: `app`, `web`, `postgres`, `seaweedfs` — exactly the four services §21.4 calls for at S0. Named volumes for Postgres and SeaweedFS data (never bind-mounted, per §21.3). `depends_on: condition: service_healthy` throughout, not the bare form. No published Postgres port. No migrations run from an entrypoint.
- `docker/nginx/default.conf`: nginx serves the built SPA at `/` and fastcgi-proxies `/api` and `/up` to `app:9000` — a single same-origin entrypoint, no CORS needed for the containerized build.
- `docker/seaweedfs/s3.json`: a scoped S3 identity for the dev SeaweedFS instance.

**CI** — `.github/workflows/ci.yml`, one `backend` job and one `frontend` job (each agent added its own without clobbering the other): Pint → Larastan → Pest; `tsc -b` → ESLint → Vitest. Not yet pushed/run on GitHub Actions itself — see "What's next."

**The spike, actually run:**
```
$ docker compose up -d
 ✔ app healthy · postgres healthy · seaweedfs healthy · web healthy
```
- `curl -H 'Range: bytes=...' <presigned-url>` → **`206 Partial Content`** with a correct `Content-Range`, confirmed against a real object stored in SeaweedFS via `Storage::disk('media')->put()`.
- The same request carrying an `Origin` header gets back correct `Access-Control-Allow-Origin` / `Access-Control-Expose-Headers` — §8.7's untested Origin-against-bucket-CORS combination, confirmed working.
- **`AWS_USE_PATH_STYLE_ENDPOINT` proven necessary, empirically, in writing:** disabling it makes Laravel sign a URL against host `media.seaweedfs:8333`, which SeaweedFS's S3 gateway does not serve (virtual-hosted-style buckets aren't supported) — confirmed **404** against that exact URL. Path-style is required, not a stylistic choice.
- `GET /api/spikes/presign` round-trips end-to-end through nginx → php-fpm → SeaweedFS and back, using a URL a browser could actually load.

**R2 (presigned `Range`) is answered** — the mechanics work, with real HTTP responses, not just code review. **R1 (WebKit `cuechange`) is not** — see below.

---

## Difficulties encountered

1. **Two `localhost` → `::1` healthcheck failures.** Both SeaweedFS's and nginx's Alpine-based images resolve `localhost` to `::1` in their `wget`, but neither server listens on IPv6 by default — every healthcheck failed with "connection refused" even though the servers were fine. Fixed by pointing healthchecks at `127.0.0.1` (SeaweedFS) and `nc -z` for a bare port check (SeaweedFS's S3 API correctly 403s an unsigned request, which isn't a clean 2xx to assert on).
2. **`apk del libzip-dev icu-dev` silently removed the runtime `libzip`, not just the headers**, because nothing else in the image depended on it — `zip`/`intl` extensions failed to load (`Unable to load dynamic library 'zip'`) despite the build succeeding cleanly. This only surfaces by *running* the container and checking `php -m`, not by building the image, which is exactly the kind of failure a healthcheck exists to catch early rather than months later.
3. **Port 8000 was already bound** by an unrelated project's container on this host (`recipe-app-api-proxy`) — `web` was moved to 8080.
4. **The most consequential one:** the presigned URL host defaulted to `seaweedfs:8333` — resolvable *inside* the Docker network, not from a browser on the host. SigV4 signs the `Host` header, so this can't be patched after the fact by rewriting the hostname; the fix was a second `media_public` Flysystem disk, identical except for `endpoint`, used only for signing. This is a real architectural point worth carrying forward past S0: **any environment where the app's internal service-discovery address differs from the browser-facing address needs two disks, not one**, and it would have shipped broken if the spike hadn't actually been run end-to-end with `curl` against the literal returned URL.

## Mistakes made

- The first `compose.yaml`/`Dockerfile` pair was written and reviewed for correctness against the plan's prose, but not actually run, before the backend/frontend scaffolds landed — all four problems above were caught only once `docker compose up` was executed for real and the returned presign URL was curled. **Static correctness against a spec is not the same as verified correctness**; nothing here would have been caught by code review alone.
- `MediaUrlSigner`'s default disk was changed from `media` to `media_public` without immediately checking the existing unit/feature tests, which mock `Storage::shouldReceive('disk')->with('media')` — this broke 3 of 6 backend tests until the mocks were updated to match. A pre-existing test suite is a contract; changing behavior it covers should have meant re-running it in the same step, not after.
- Larastan's config was written assuming "Larastan 5" per the plan's literal wording; **no v5 exists** (current major is 3.x). The backend agent caught and noted this, but it's worth flagging here too: the plan's version pins should be treated as intent, not gospel, and verified against what's actually installable at build time.
- `npx tsc --noEmit` against the root `tsconfig.json` is a silent no-op (it's a solution file with no `include`, per TS project-references convention) — the frontend agent caught this by deliberately injecting a type error and watching it go uncaught, then switched every check (local and CI) to `tsc -b`. Flagging it here because it's a trap that would have shipped a green CI with a checker that checks nothing.

## What was not verified from here — closed out by hand on 2026-08-07

STEP-00's acceptance criteria explicitly require a **real browser**; this environment had no GUI browser to drive, so these three were finished manually and are now done:
- The object originally placed in SeaweedFS for the curl tests was a synthetic 2 MB byte blob (`str_repeat('0123456789', ...)`), not a real, decodable MP4. **Fixed:** a real short H.264/AAC MP4 was uploaded to `spikes/sample.mp4` via `aws s3 cp --endpoint-url http://localhost:8333`.
- "the same object seeks correctly inside a real `<video>` in Chrome and Safari" — **done.** Verified manually in both browsers against the real MP4; the scrubber seeks correctly in each.
- "Measured cue latency for all three drivers is committed to the repo" — **done.** See [SPIKE-RESULTS.md](SPIKE-RESULTS.md) for the Chrome and Safari tables. Notably, `texttrack` diverges sharply between browsers (~6ms Chrome vs. ~119ms Safari) while `rvfc` stays low and consistent in both (~11-23ms) — real signal for the step-06 driver decision, and a concrete instance of the R1 risk this step exists to surface.

These three were the actual point of S0 per the plan ("both artifacts are things a human can look at").

---

## Next step

Per [STEPS.md](STEPS.md), **[Step 01 — Account and identity](STEP-01-identity.md)** is next on the critical path (`00 → 01 → 03 → 05 → 06 → 07`). S0's acceptance list is now genuinely complete — infrastructure, code, and the human-verified browser checks above are all done.

## What could be done now, per CP-00

[CP-00 — Your first workflow](CP-00-first-workflow.md) is optional and doesn't block Step 01, but this session is unusually good timing for it: `.github/workflows/ci.yml` already exists and is real (Pint → Larastan → Pest, `tsc -b` → ESLint → Vitest), which is considerably past CP-00's own starting point (`echo "It ran."`). Rather than rebuild it from scratch by hand, the CP-00-shaped exercises that are still genuinely valuable here:

- **Push this branch and watch the workflow actually run on GitHub's infrastructure** — everything above was verified locally; the workflow itself has never executed on a real Actions runner. CP-00's core lesson ("the runner starts completely empty") is best learned by watching *this* real workflow either pass or reveal an assumption baked in by a local environment (a PHP extension present on this host but not in `setup-php`, for instance).
- **Deliberately break it once**, per CP-00's explicit instruction — introduce a type error in `web/` or a Pint violation in `api/`, push, watch it go red, read the actual failure log, then fix it. This repo has that muscle memory built into neither agent's session; a human doing it once is the point, not a spectator.
- **Read `gh run watch` / `gh run view --log-failed`** against the real run once pushed, per CP-00's "going deeper" section.

Everything else CP-00 teaches (workflow/event/job/runner/step/action vocabulary, why `npm ci` not `npm install`, why action versions are pinned) is already reflected correctly in the CI file as written — reading `.github/workflows/ci.yml` itself alongside CP-00 is a reasonable substitute for building it from the ground up.
