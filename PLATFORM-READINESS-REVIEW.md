# Platform readiness review

**Date:** 2026-10-31 · **Branch:** `development` · **Scope:**
- the backend (`api/`) and the SPA (`web/`);
- the 43 migrations;
- `Dockerfile`, the compose files and the CI workflows;
- the root docs and the sibling `../speechcoach-deploy-target` repo.

**UX mockups:** [PLATFORM-REVIEW-UX-MOCKUPS.html](PLATFORM-REVIEW-UX-MOCKUPS.html) in this folder. The same page is also published as a private page: <https://claude.ai/artifact/JPybbnw6coV33QnuNqEijJ>.

**How it was made:** six review agents ran in parallel, covering:
- the backend;
- the database;
- the frontend;
- UX;
- dependencies and Docker images;
- readiness for live testing.

I then re-checked about 30 of their key claims against the code; §7 lists what was checked and corrected. Docker was not running, so no finding comes from the live stack. They come from reading code and from read-only tools:
- a `vite build` into a scratch folder;
- a migrate/reset on a throwaway SQLite file;
- PHP benchmarks on the host;
- advisory lookups on OSV.dev;
- tag lookups in the Docker Hub and GitHub registries on 2026-10-30.

Each finding keeps its agent's ID (BE-, DB-, FE-, OPS-, RD-) so it can be traced.

---

## The short answers

| Question | Answer |
|---|---|
| **1. Is it effectively complete and ready for live testing?** | **Complete, but not ready for outside testers.** Steps 00–13 shipped, and 14–15 are partly done. The product loop works end to end on the dev stack, and a grep finds no TODOs, stub routes or placeholder screens. It is ready for an internal alpha on your own machine. It is **not** ready for invited outside testers. There is no real host, domain or email, and a fresh production database can't register anyone. There is no privacy notice or consent step, several base images are past end of life, and admin powers over the API skip MFA. Most of the gap is operations work, not features: roughly 2–3 weeks. |
| **2. Can it be more efficient?** | **Yes, with mostly small changes.** The biggest cost is delivery: every visitor downloads one 2.4 MB JavaScript file, served uncompressed. Gzip plus route-level splitting brings first visits to roughly 320 KB. The second biggest is polling: My speeches re-signs up to 160 URLs every 3 seconds, and those URLs change every second, so posters re-download on every poll. Third, fixed per-request cost measured 11.9 ms on the host and drops to 7.5 ms with standard Laravel caching and production opcache. |
| **3. Can the UX be more ergonomic?** | **Yes.** Most findings from the 2026-10-10 UX review are now fixed. What's left is friction between screens: <ul><li>new users land on an empty reviewer inbox;</li><li>the upload flow stops before the invite step;</li><li>the speaker's reviewer switch sits two panels below the video;</li><li>coaches send feedback through two buttons, and the essay one notifies nobody.</li></ul> Eight proposals with before/after mockups are in the companion page. The review also found **a privacy bug**: the "revoke and delete" dialog tells the speaker how many unpublished drafts the coach has. |
| **4. Are the images up to date?** | **No.** Alpine 3.20 sits under the PHP runtime, every worker and ClamAV, and it reached end of life on 2026-04-01. PHP is frozen at 8.4.8, and nginx 1.27 is out of support. The ClamAV that scans untrusted coach PDFs is version 1.2.2, which is past end of life and affected by a critical PDF-parsing CVE. Uptime Kuma v1 runs on an end-of-life Node 18, and three services use unpinned `:latest` tags. On the library side, a `composer update` and `npm update` within your current version ranges fix every known advisory, including a paste-XSS in the essay editor. |

**In plain words:** the house is built and the rooms are furnished, but it isn't connected to the street yet. There's no address (domain), no mailbox (email), no sign on the door saying what happens to visitors' videos (privacy notice), and some of the building materials are past their warranty (images). Inside, a few doors are heavier than they need to be (UX), and some lights stay on in empty rooms (polling).

---

## 1. Is it complete and ready for live testing?

### 1.1 Readiness by level

| Level | Verdict | What stands in the way |
|---|---|---|
| **A.** Internal alpha on the dev stack: you, and people at your machine | **Go**, with caveats | <ul><li>Access only through `/etc/hosts`.</li><li>The operator guide is out of date (§1.6).</li><li>The e2e suite is flaky: 8 of the last 40 CI runs failed, most in the Playwright step.</li></ul> |
| **B.** Closed beta with invited outside testers on a real host | **No-go** | Blockers B1–B12 (§1.3) |
| **C.** Public launch | **No-go** | Everything in B, plus C1–C6 (§1.5) |

### 1.2 Feature completeness by step

| Step | Status | Most important remaining gap |
|---|---|---|
| 00 Foundation | Shipped | Spike wall only, behind a disabled flag |
| 01 Identity | Shipped | Email only ever reaches Mailpit (see B2) |
| 02 First deploy | Shipped, for local `.test` only | No real domain or TLS (B1) |
| 03 Upload and watch | Shipped | No server-side content-type allow-list; reload loses an upload in flight |
| 04 Every video plays | Shipped | Rotated phone video never tested against a real fixture |
| 05 Invitation loop | Shipped | The two-users isolation spec isn't in CI |
| 06–08 Commentary, writing, essay | Shipped | Safari/iOS unverified |
| 09 Captions | Shipped (no retrospective) | Whisper smoke test passed on 2026-10-29 |
| 10 Voice annotation | Shipped | No real Safari/iPhone evidence |
| 11 Privacy and erasure | Engineering shipped; the legal half not started | §11.1 has no artifacts at all (B4) |
| 12 Admin portal | Shipped | Panel MFA now enforced; the API layer still isn't (B7) |
| 13 Social layer | Shipped | Its EXPLAIN verification script isn't in CI |
| 14 Deploy hardening | **Partial** | Faux server only: no mail, DNS or TLS, and deploys stalled (B1) |
| 15 Accessibility | **Partial** | No screen-reader test, no Lighthouse, no roving tabindex (C5) |

### 1.3 Blockers for a closed beta (level B)

| # | Blocker | Evidence | Fix | Effort |
|---|---|---|---|---|
| **B1** | **No production host, domain, TLS or working deploy.** <ul><li>The "production" target is a laptop container on `127.0.0.1:2222` that only exposes SSH and runs php-fpm, with no Horizon and no scheduler.</li><li>`deploy.sh` ships only `api/`: no SPA, no images, no worker restart. `vendor/` is copied from the target's baked image, so `composer.lock` changes never ship.</li><li>The last successful production deploy was 2026-10-13. Staging has 0 successes in 27 runs.</li><li>The only full stack, compose, runs with `APP_ENV=local` and `APP_DEBUG=true`.</li></ul> | `deploy.yml:39`; `deploy.sh:65-70,95-137`; deploy-target `docker/sshd/entrypoint.sh`; `provision.sh:123-125`. RD-1, RD-4, OPS-1, BE-1 | Define the production topology, for example compose on the host using the built images, with Horizon and the scheduler. Ship the SPA, use a hosted runner plus SSH, and commit the uncommitted deploy-target work. Zero-cost options: an Oracle Cloud Always Free VM (ARM, so whisper.cpp and ffmpeg need ARM builds), or a home machine behind a Cloudflare Tunnel; a free subdomain (DuckDNS); Caddy or certbot for Let's Encrypt TLS. *Check current terms for each.* | L |
| **B2** | **No production email.** <ul><li>Mail defaults to `log` (verified `config/mail.php:17`), dev and faux-prod both use Mailpit, and the from-address is `hello@example.com`. There's no SPF, DKIM or DMARC.</li><li>`verified.api` gates writes, so testers could never verify their account or reset a password.</li><li>Verification and reset emails are sent inside the HTTP request, so an SMTP failure can make `/register` fail after the user row is already saved.</li></ul> | `.env.example:151-157`; `provision.sh:144-147`; `routes/api.php:80,186,288`. RD-2, BE-2 | A free-tier SMTP relay (the agent cited Brevo's ~300/day; *confirm current limits*), the DNS records, a real delivery test to a Gmail inbox, and queued auth notifications | M |
| **B3** | **A fresh production database can't register anyone.** <ul><li>The deploy runs only `migrate` (verified `deploy.sh:105`). Roles and reserved usernames come only from seeders.</li><li>`CreateNewUser` assigns `member` inside a transaction (verified `CreateNewUser.php:63-69`), so every signup throws and rolls back.</li><li>With no reserved names, anyone could take `admin`. The first super_admin can only be made from the CLI.</li></ul> | DB-1, RD-6 | **Roles: fixed on 2026-10-31.** The migration `2026_08_07_000612_create_default_roles` creates them, and `DefaultRolesMigrationTest` proves a migrated-only database can register users. **Still open:** <ul><li>reserved usernames, which need the same treatment;</li><li>a one-page runbook for the first super_admin: register, then `php artisan user:grant-role <email> super_admin`.</li></ul> | S |
| **B4** | **No legal or consent layer:** no privacy notice, terms, acceptable-use policy, recording or voice consent, age attestation or cookie notice. | No `/privacy` or `/terms` route in `web/src` (verified); `Register.tsx` collects only email and password; `STEP-11-FROZEN-CONTRACT.md:9-18`. RD-3 | For a beta: a plain-language privacy notice, beta terms, a consent checkbox stored with a timestamp, and an 18+ attestation. For launch, see C1. *This review is not legal advice.* | M |
| **B5** | **End-of-life base images, and a virus scanner with a critical CVE.** <ul><li>Alpine 3.20 (EOL 2026-04-01) is under the runtime, all workers and ClamAV.</li><li>PHP 8.4.8 is 19 patch releases behind, and nginx 1.27.5 has been out of support since 2025-06.</li><li>ClamAV 1.2.2 comes from Alpine 3.20's packages (verified `Dockerfile:398-399`). It is EOL and affected by CVE-2025-20260 (CVSS 9.8, PDF parsing), yet it scans untrusted PDFs. EOL ClamAV versions may also be blocked from signature updates.</li></ul> | OPS-2, OPS-3 | Move every Alpine stage to 3.24 together, and the PHP base to `php:8.4-fpm-alpine3.24`. Use `nginx:1.30-alpine` and the official `clamav/clamav:1.4` (LTS). Then re-run the whisper `ldd` check and `php -m`. | M |
| **B6** | **Libraries with known vulnerabilities:** <ul><li>a `symfony/http-foundation` ReDoS reachable without logging in;</li><li>four high-severity `league/commonmark` advisories (used in mail markdown);</li><li>Laravel framework advisories;</li><li>Filament's MFA-management advisory GHSA-7m6h, fixed in 4.13.3;</li><li>a TipTap/ProseMirror paste-XSS that ships in the browser bundle.</li></ul> | `composer.lock`, `web/package-lock.json`, checked through OSV.dev. OPS-4, OPS-5 | `composer update` and `npm update @tiptap/*` within the current version ranges, then confirm `prosemirror-view` ≥ 1.42.3 and run the full suite | S |
| **B7** | **Admin powers over the API skip MFA.** The panel and Horizon now enforce the MFA stamp. But `Gate::before` returns `true` for admin-tier users on any ability outside its fall-through list, with no stamp check (verified `AppServiceProvider.php:310-388`). An admin's password-only SPA session can therefore read any speech's captions and transcript, and speech ids are sequential. | `CaptionController.php:49`; `TranscriptController.php:39`. RD-7, BE-4 | Return `null` from `Gate::before` unless `FilamentMfaStamp::isValid()` holds, or take caption and transcript reads out of the bypass | S–M |
| **B8** | **Queue jobs retry forever, and deploys don't restart Horizon.** <ul><li>`supervisor-default` sets no `tries`, `backoff` or `maxProcesses` (verified `config/horizon.php:228-233`), and none of the 11 queued notifications sets `$tries`. One permanently rejected email therefore loops forever on the only default worker, ahead of scans, exports and purges.</li><li>No script runs `horizon:terminate` (verified), so workers keep running code from release folders that get deleted.</li></ul> | BE-3, BE-5 | `tries: 3`, `backoff: [10, 60, 300]` and `maxProcesses: 2–3`; run `php artisan horizon:terminate` after the symlink swap | S |
| **B9** | **Backups are manual, laptop-local and incomplete.** `backup.sh` covers Postgres and the `seaweedfs-data` volume but not `application-documents`, where the coach PDFs live (verified). There's no timer, the last backup is from 2026-10-06, and the restore drill ran on toy data. | `backup.sh:55,67`; `compose.yaml:780`. RD-5 | A nightly timer, an off-box copy (free object-storage tiers exist; *check current terms*), the documents volume added, and the drill re-run | M |
| **B10** | **The production config isn't production-shaped.** <ul><li>`.env.example` is dev-shaped (`APP_ENV=local`, `APP_DEBUG=true`, `LOG_LEVEL=debug`; verified).</li><li>`php.ini-production` is never activated (verified: the Dockerfile never references it), so PHP's built-in defaults apply.</li><li>opcache rechecks file timestamps.</li><li>`DISABLE_ADMIN_MFA=true` is safe only while `APP_ENV` isn't `local`.</li><li>Faux-prod sets `QUEUE_CONNECTION=database`, but Horizon reads Redis. It also leaves out `REDIS_CLIENT`, which defaults to phpredis, an extension the image doesn't install.</li></ul> | RD-12, OPS-6, OPS-11, BE-1 | Add `.env.production.example` with secret generation, a production `php.ini` and opcache ini, and either predis or the phpredis extension | S |
| **B11** | **The test-account seeder can run in production.** `E2ESeeder` and the voice seeder have no environment check (verified). They create super_admin and admin accounts with the password `password` and TOTP secrets committed to the repo. Their fixed ids don't advance the Postgres sequences, so later inserts collide. | `E2ESeeder.php:22,82-90,223`. RD-11, DB-6 | `abort_if(app()->isProduction())` in every E2E seeder, and `setval` after the fixed-id inserts | S |
| **B12** | **Sign-up and password reset are unthrottled.** Only the login limiter is configured (verified `config/fortify.php:132-134`), so bots can create accounts and trigger email without limit. | BE-6 | Throttle `/register`, `/forgot-password` and `/reset-password` by IP | S |

### 1.4 Fix before outside testers, though not blocking on their own

| # | Issue | Evidence | Fix | Effort |
|---|---|---|---|---|
| **S1** | **Privacy:** the "Revoke and delete their work" dialog reads "This deletes 7 notes, 3 of them published", using the count that includes drafts. That tells the speaker the coach has 4 unpublished drafts. It breaks "the speaker never sees a coach's drafts", and the same leak was already fixed once, in the note-count badge. The roster API also sends that count to the speaker. | Verified: `RevokeReviewDialog.tsx:104`; `ReviewRosterResource.php:43`; rule at `IMPLEMENTATION-PLANS.md:232` | Show only the published count, and drop `annotations_count` from the owner's roster payload | S |
| **S2** | **Account erasure leaves personal data behind:** the user's own notifications, other users' notifications that hold their name, and ready export ZIPs (kept up to 7 days). | Verified: nothing in `app/Services/Privacy/` touches notifications or exports. DB-5 | Add erasure steps, or resolve names when notifications are read | M |
| **S3** | **Deleted or taken-down speeches stay on the profile timeline**, with title, ulid and a signed poster URL. The timeline only shows the viewer's own link with that person, so the exposure is the other party to the review, not the public. | Verified: no `deleted_at` filter in `ProfileTimelineController.php:56-78`. DB-3 | Add `whereNull('speeches.deleted_at')` and a test | S |
| **S4** | **Reviewer search is case-sensitive on Postgres**, so "sarah" won't find "Sarah". The tests pass only because SQLite's `LIKE` ignores ASCII case. | Verified: `User.php:124-128` uses plain `like`. DB-2 | `whereLike()`, which compiles to `ILIKE`, or `LOWER()` as the other searches already do | S |
| **S5** | **Publishing an essay notifies nobody.** Notes publishing sends `ReviewPublished`; the essay only stamps a date. | Verified: `EssayService.php` has no notification. UX | Notify on the first essay publish (see UX proposal 4) | S |
| **S6** | **Big uploads can dead-end.** <ul><li>Nothing resumes after a reload, and nothing warns before leaving mid-upload.</li><li>An abandoned upload offers Retry, which re-transcodes a source that never finished.</li><li>No screen attaches a video to an existing speech.</li></ul> | `UploadDashboard.tsx:29-32,234-243`; `SpeechCreate.tsx:77-80`; `StatusBadge.tsx:72-83`. FE-2 | `beforeunload` plus `useBlocker` while uploading; hide Retry for `upload_abandoned`; add an "Upload video" action | M |
| **S7** | **My speeches shows only the first 20 speeches**, and so does the "replaces an earlier attempt" picker. | Verified: `paginate(20)` at `SpeechController.php:43`; the SPA never requests page 2. FE-6 | A page argument and "Load more" | S |
| **S8** | **Crashes outside the logged-in shell**, on guest pages, onboarding and profiles, show React Router's raw error page with a stack trace and never reach GlitchTip. | No `errorElement` or router `onError` anywhere. FE-1 | A root `errorElement` that reports the error, plus `onCaughtError` on `createRoot` | S |
| **S9** | **A failed list request looks like empty data**, for example "No speeches yet." | `MySpeeches.tsx:38-64`; `Dashboard.tsx:31-50`. FE-8 | An error state with Retry | S |
| **S10** | **Postgres-only behaviour is untested.** Pest runs on SQLite, where all 104 `lockForUpdate` calls do nothing; uuid, jsonb and NULL ordering also differ. | `phpunit.xml:26-27`. DB-4 | A CI job that runs Pest against a `postgres:17` service container (free on Actions) | M |
| **S11** | **Bad input returns 500 on Postgres:** `/speeches/abc` hits a bigint column (error 22P02), and invalid UTF-8 in search queries also fails. | `routes/api.php:67` is the only `whereNumber`. DB-7 | `Route::pattern()` for numeric and uuid parameters, plus a shared UTF-8 rule | S |
| **S12** | **Upload size isn't enforced at storage.** <ul><li>Part URLs carry no size limit, and quota is reserved on the size the client declares.</li><li>Two 10 MB coach PDFs exceed the 20 MB PHP and nginx body limits and fail with a 413.</li></ul> | Verified `uploads.ini` and `client_max_body_size 20m`. BE-11 | Sign parts with a content length, reject oversize uploads on completion, and raise the document-upload limit | S |
| **S13** | **No off-box monitoring or alerting**, and a new abuse report notifies nobody. | RD-8 | A free external uptime check, real alert email, and an admin notification on new reports | S |
| **S14** | **Logs and disk:** a single unrotated JSON log at debug level; a default 5 GiB per-user quota with no disk sizing. | `logging.php:111-117`. RD-9, BE-13 | A daily log channel or logrotate, and disk sized to testers × quota | S |
| **S15** | **No support channel or tester guide.** | No contact or feedback link in `web/src`. RD-10 | A footer contact, a feedback inbox and a one-page tester guide | S |
| **S16** | **CI gaps.** <ul><li>7 Playwright spec files never run, including `two-users.spec.ts`, the only browser-level check that reviewers can't see each other.</li><li>`admin-style.spec.ts` has never passed: its last run was 32 of 32 tests skipped.</li><li>Required-check names don't match, so merges to master go through admin bypass.</li></ul> | `ci.yml:348,357`. FE-11, RD-18 | Add at least two-users, friends and register-validation to CI; require the real check names | S |
| **S17** | **`DELETE /api/me`** has no SPA caller and runs an irreversible partial erasure with no last-admin guard. | `EraseSelfAccount.php`. BE-12 | Remove it, or route it through `AccountErasureService` | S |
| **S18** | **Housekeeping isn't scheduled.** <ul><li>No scheduled `queue:prune-failed`, `auth:clear-resets`, notification pruning or `horizon:snapshot`.</li><li>No S3 client timeouts and no php-fpm `request_terminate_timeout`.</li></ul> | `routes/console.php:20-57`. DB-15, BE-13 | Add the schedules and timeouts | S |
| **S19** | **The onboarding username check** calls `/api/username-availability`, which doesn't exist, producing one 404 per typing pause. The gap is documented and intentional (`profileApi.ts:110-116`): the UI falls back to the check on submit. | FE-13, BE-12 | Add the endpoint, or remove the hook | S |

### 1.5 Before a public launch (level C)

- **C1. Legal review:** face and voice recordings may count as biometric data under state laws such as BIPA (Illinois) and CUBI (Texas). Children's privacy (COPPA) also needs an answer.
- **C2. Security headers:** HSTS, CSP and `X-Frame-Options`. Today only the document-download controller sets any (RD-13).
- **C3. Upload types:** a server-side content-type allow-list for uploads (RD-14).
- **C4. Content policy:** an escalation path for illegal content and an acceptable-use policy, both of which the plan requires before launch (`MODERNIZATION_PLAN.md:2139`, RD-15).
- **C5. Accessibility:**
  - a real assistive-technology pass with a screen reader, plus Lighthouse;
  - roving tabindex;
  - a page title for each route;
  - `<main>` landmarks on the guest pages (RD-16, FE-12).
- **C6. Devices:** Safari and iOS verification of playback and voice notes, and a portrait iPhone test fixture (RD-17).

### 1.6 Docs are behind the code

- **`README.md`:** still says "no application code" and gives a 34–41 week plan. `api/README.md` and `web/README.md` are still framework boilerplate.
- **The operator and testing guide** (last verified 2026-09-30):
  - It still calls Steps 14–15 "Not built" and captions "Blocked".
  - It describes a separate admin login that now redirects to the SPA.
  - It says registration assigns no role.
  - It doesn't mention the coach-application review page, the admin dashboard, the audit log, friends or the admin restyle.
- **Production runbook:** none exists for bootstrap, secrets, mail or backups.
- **Retrospectives:** some are out of date in the good direction. STEP-15's two live bugs are fixed, and STEP-12's "suspension has no test" is outdated. STEP-09 and STEP-11 have no retrospective.

---

## 2. Efficiency and performance

### 2.1 Wins ranked by impact for effort

| # | Change | Effect | Effort | Source |
|---|---|---|---|---|
| 1 | **Turn on gzip in nginx, and long-lived caching for the SPA's hashed `/assets/*`.** Admin panel assets already get `expires 1y` (`default.conf:101-105`); the SPA's don't, and nothing enables gzip (both verified). | The entry chunk goes from 2.40 MB to 731 KB over the wire, and repeat visits come from cache | S | FE-4, OPS-9 |
| 2 | **Load heavy screens on demand** with `lazy()` routes for the watch page, upload, become-a-coach, onboarding and profiles. **Import the video.js core build** (`video.js/dist/alt/video.core.js`). | Guest pages drop from ~731 KB to ~320 KB gzip; video.js alone saves ~126 KB gzip | M | FE-3, FE-7 |
| 3 | **Poll My speeches only while something is uploading or processing**, skip unfocused tabs, and **sign poster URLs against a time rounded to the hour** so they stay stable. | Today each open tab triggers up to 160 URL signatures (~37 ms CPU), about 8 queries including a session write, and a re-download of every poster, every 3 s | S–M | BE-7, FE-5 |
| 4 | **Cache config, routes and events, run `filament:optimize`, and ship a production opcache** (`validate_timestamps=0`). Filament/Livewire start-up is ~5.8 ms of every API call. | Measured 11.9 → 7.5 ms per request on the host | S | BE-8 |
| 5 | **Move sessions and cache to Valkey**, which already runs idle, and use phpredis. | Removes a Postgres write from every request, polls included | S | BE-9, DB-9 |
| 6 | **Poll less elsewhere:** `skipPollingIfUnfocused` everywhere, the owner roster every 15–30 s instead of 3 s, the bell every 60 s. | Background tabs stop generating load | S | FE-10 |
| 7 | **Stop the watch page re-rendering on every `timeupdate`:** move `currentTime` into the overlay that uses it, memoise the transcript, and stop the playhead animation loop while paused. | Smoother playback on slow devices | S | FE-9 |
| 8 | **Database tidy-up:** <ul><li>a notifications index on `(type, id, created_at desc)` plus a partial unread index, and pruning of read rows;</li><li>an audit-log index on `created_at`;</li><li>drop the transcript `tsvector`/GIN index nothing queries, and one redundant reviews index.</li></ul> | A cheaper bell and admin list, and cheaper transcript writes | S | DB-10–13 |
| 9 | **Raise CORS `max_age` from 0 to 7200.** | Removes one preflight request per API call in the split-domain layout | S | BE-10 |
| 10 | **Smaller, faster images:** <ul><li>add `api/build/` (125 MB phpstan cache) and `web/test-results/` (114 MB) to `.dockerignore` (verified missing);</li><li>stop keeping `postgresql-dev`, which pulls in clang and llvm (verified never removed).</li></ul> | Builds stop being invalidated by test runs; an estimated ~300 MB less per PHP image | S | OPS-7, OPS-8 |
| 11 | **Run CI once per push, not three times,** with buildx GitHub Actions caching and no whisper.cpp compile in the e2e job. | Faster feedback, fewer queued runs | M | OPS-10 |
| 12 | **Small N+1s and unbounded lists:** <ul><li>roles are queried per directory row;</li><li>`GET /api/reviews` returns unpaginated sections;</li><li>the speech list has no `id` tiebreak;</li><li>the timeline arc lookup is N+1;</li><li>erasure deletes storage inside the HTTP request.</li></ul> | Steadier at scale | S–M | BE-14, DB-14 |
| 13 | **Avatars:** 96 and 192 px WebP variants, stable signing, and an initials fallback. Today a 512 px JPEG is shown at 32–96 px and re-signed on every response, so it is never served from cache. | Less bandwidth on every page with faces | M | FE-16 |

**Not worth changing:** the per-request asset hashing in `AdminWorkspaceAssets` that an earlier review flagged. It measured **0.055 ms**.

### 2.2 What the SPA bundle is made of

The build was made in a scratch folder with Vite 8.2. All JavaScript totals 2.46 MB raw, 747 KB gzip, in four chunks; one entry chunk holds 731 KB gzip of it.

| Inside the entry chunk | Est. gzip | Needed only by |
|---|---|---|
| video.js family | ~195 KB | The watch page |
| TipTap / ProseMirror | ~127 KB | The essay tab |
| App code | ~88 KB | All pages |
| Uppy (with preact, exifr) | ~78 KB | Upload, become-a-coach |
| react-dom | ~59 KB | All pages |
| Base UI | ~50 KB | All pages |
| wavesurfer | ~12 KB | Voice notes |

Fonts are already self-hosted with `font-display: swap` and subsetting, which is fine as is. The dev-only spike page (~8.5 KB) still ships in the production bundle (FE-17).

---

## 3. UX: can it be more ergonomic and intuitive?

**Open the mockups:** [PLATFORM-REVIEW-UX-MOCKUPS.html](PLATFORM-REVIEW-UX-MOCKUPS.html) (also at <https://claude.ai/artifact/JPybbnw6coV33QnuNqEijJ>). Each proposal shows today's screen, built from labels copied out of the code, next to the proposed design. It includes numbered call-outs and the pros and cons.

### 3.1 Since the last UX review (2026-10-10)

**Fixed:**
- roles at registration;
- un-inviting through the roster with revoke;
- notifications when notes are published;
- feedback shown by default;
- awaiting-reply invites shown;
- speech edit and delete;
- links in notifications;
- the quota meter;
- the landing page;
- a keyboard map;
- the audit-log browser;
- the super-admin roster.

**Still open:**
- the essay publish notification (S5);
- publishing is irreversible with no confirmation;
- keyboard shortcuts are never shown on screen;
- no rubric;
- reports are the only inbound signal for admins;
- the directory isn't something you can make a decision from;
- inviting by email (blocked on B2);
- the "Let them preview…" checkbox, which nothing reads;
- the draft-count leak (S1).

### 3.2 The eight proposals

| # | Proposal | Who it helps | Effort | Main win | Main risk |
|---|---|---|---|---|---|
| 1 | A home that says what to do next: a "Get started" card, or a two-lane Home | New users, speakers | S / M | The first screen always has one clear action | Needs per-speech review counts; renaming "My reviews" touches ~41 references |
| 2 | Upload and invite in one flow | Speakers | S–M | The first invitation takes one screen instead of ~6 | Multi-select needs several calls or a batch endpoint |
| 3 | Faster note capture with visible shortcuts, plus a phone capture bar | Reviewers, coaches | S / M | About half the pointer trips per note | End must never fill itself in, per the range-authoring plan |
| 4 | One "Review & send" step, with guarded Withdraw and Abandon | Coaches, speakers | M | The essay's arrival is announced, and nothing irreversible fires on one click | One extra click for coaches who publish in batches |
| 5 | One "Feedback from" bar at the video, side by side on wide screens | Speakers | M | The reviewer switch sits next to what it changes | Must stay single-select; pinned accessible names in e2e specs |
| 6 | Access and removal in plain language, with "Who can see this speech" | Speakers | S–M | **Closes the draft-count leak**; one menu per person | Canned reasons are sent word for word |
| 7 | A directory you can choose from: faces, bios, "Invite to…" | Speakers, coaches | S–M | People can choose, and the social layer feeds the core loop | Bios are a moderation surface; "Connected" must never reveal a block |
| 8 | An admin decision panel for coach applications | Admins | S | Evidence, the blocked reason and the decision on one screen | Polling cost; keep the confirm step and `role.assign` check |

None of the eight weakens the load-bearing rules: exactly one reviewer's commentary plays at a time, reviewers never see each other's commentary, and only an admin makes a coach. Proposal 5 keeps the first by design, and proposal 6 restores the drafts rule that S1 breaks.

**Smaller fixes that need no mockup:**
- notification timestamps, "Mark all read" and a proper `speech.deleted` message;
- a page title for each route;
- bring Register, Forgot password, Reset password, Verify email and Onboarding into the new login look;
- replace `window.prompt` for essay links;
- error states with Retry (S9).

---

## 4. Are the images up to date? What can be improved?

### 4.1 Docker images

Upstream versions were checked against the registries on 2026-10-30.

| Image | Used | Latest stable | Support status | Recommendation |
|---|---|---|---|---|
| `php:8.4-fpm-alpine3.20` (app and all workers) | PHP 8.4.8, a tag frozen since 2025-06 | 8.4.27 on alpine3.24; 8.5.12 | **Alpine 3.20 EOL 2026-04-01.** PHP 8.4 active support ends 2026-12-31 and security support 2028-12-31. | `php:8.4-fpm-alpine3.24` now, 8.5 later |
| `alpine:3.20` (whisper build, model init, ClamAV) | 3.20.10, the final release | 3.24.3 | **EOL** | 3.24, moved together with the runtime |
| ClamAV (Alpine package) | 1.2.2 | 1.5.4; 1.4.6 LTS | **EOL; CVE-2025-20260 (CVSS 9.8)** | `clamav/clamav:1.4` |
| `nginx:1.27-alpine` | 1.27.5 | 1.30.6 stable | **EOL 2025-06-24** | `nginx:1.30-alpine` |
| `node:22-alpine` (build only) | 22.23.4 | 24.x / 26.x LTS | Maintenance until 2027-04-30 | `node:24-alpine`, in CI too |
| `composer:2` (build only) | 2.11.0 on PHP 8.5 | same | Current, but it builds `vendor/` on PHP 8.5 for an 8.4 runtime | Pin `composer:2.11` and set `config.platform.php` to 8.4 |
| `postgres:17-alpine` | 17.11 | 18.6 | Supported until 2029-11 | Stay on 17; pin the minor and digest |
| `valkey/valkey:8-alpine` | 8.1.11 | 9.1.3 | 8.1 supported until 2030-03 | Keep; pin `8.1` |
| `chrislusf/seaweedfs` | dev `latest`, e2e `4.42` | 4.51 | Dev and e2e have drifted apart | Pin one version by digest in both files |
| `glitchtip/glitchtip:latest` | 6.2.6 | 6.2.6 | Current, but floating, and its migrate service applies schema changes automatically | Pin `6.2.6` |
| `axllent/mailpit:latest` | v1.32.0 | v1.32.0 | Dev only | Pin `v1.32` |
| `louislam/uptime-kuma:1` | v1, on Node 18.20 | 2.5.8 | **Node 18 EOL 2025-04** | Move to `:2` and run its DB migration |
| whisper.cpp | v1.7.2 (2024-11), from the old ggerganov URL | v1.9.5 | Not EOL; about two years old | Bump after the smoke test; set `-DGGML_NATIVE=OFF` so an image built on one CPU can't crash on another |

### 4.2 Libraries worth acting on

| Package | Used | Latest | Notes |
|---|---|---|---|
| symfony/http-foundation | 8.1.2 | ≥ 8.1.7 | HIGH: ReDoS through `Cache-Control`, reachable without logging in |
| league/commonmark | 2.9.0 | 2.10.2 | 4 HIGH and 1 moderate (DoS, XSS-filter bypass); used in mail markdown |
| laravel/framework | 13.24.0 | 13.39.0 | 3 advisories. The critical TokenGuard one doesn't apply here: only the `web` session guard is configured. |
| filament/filament | 4.12.6 | 4.16.0 (v5.11 exists) | GHSA-7m6h: MFA management doesn't ask for the password again; fixed in 4.13.3 |
| @tiptap/* and prosemirror-view | 3.30.1 / 1.42.2 | 3.32.2 / ≥ 1.42.3 | HIGH: XSS on paste, and it ships to browsers |
| video.js | 8.23.9 | 10.2.0 | Two majors behind; a HIGH in `@xmldom/xmldom` arrives through mpd-parser (and goes away with the core build, §2 item 2) |
| shadcn (CLI) | 4.16.1 | 4.23.0 | Sits in `dependencies` and accounts for most of the 48 `npm audit --omit=dev` findings, though none reach the browser. Move it to devDependencies. |
| uppy (meta-package) | 5 | 6 | Never imported; remove it |
| pest / phpunit (dev only) | 4.7 / 12.5 | 5.3 / 13.4 | Majors behind; no runtime risk |

No Composer package is abandoned. GitHub Actions are on current majors but not pinned to commit SHAs.

### 4.3 Other image improvements

- **Pin every tag**, and add a digest (`image:tag@sha256:…`) for services that run in production.
- **Activate `php.ini-production`** (B10) and ship a production opcache ini.
- **Health checks:** workers and the scheduler have none. The app health check boots artisan every 10 s, and the app's dependency on ClamAV holds its startup back by up to 180 s.
- **Build-time `freshclam`** risks ClamAV CDN rate limits on CI. Moving to the official ClamAV image fixes this too.
- **Never push the FFmpeg/whisper images to a public registry.** The CI cache recommendation in §2 uses load-only builds, so nothing is pushed.

### 4.4 Visual images

- **Speech posters are done right:** WebP and JPEG variants, width and height set, lazy loading. Only `sizes` is missing, so browsers pick the widest variant.
- **Icons and share image:** the favicon is still the stock Vite logo. There's no apple-touch-icon, web manifest, theme colour or share (OG) image, and `api/public/favicon.ico` is 0 bytes.
- **Dark mode:** the admin character illustrations are hard to make out. Their outline colour against the dark page is 1.06:1 (WCAG asks for at least 3:1 for graphics). A light disc behind each scene, or outlines drawn in `currentColor`, fixes it.
- **Avatars:** see §2 item 13.
- **Repo weight:** `output/demo-profile-portraits/` commits 15.1 MB of 1254 px PNGs plus a manifest containing a local absolute path. Nine `legacy/TMCOVE*.jpg` files (709 KB) are referenced nowhere. None of this ships to users, but it bloats the repo.
- **Docs:** the HTML guides contain no screenshots, so there are no stale screenshots to update.

---

## 5. Suggested order of work

1. **Week 1, quick fixes (2–3 days):**
   - **Security and access:** B3, B6, B7, B8, B11 and B12.
   - **Privacy and data correctness:** S1, S3, S4 and S5.
   - **Small fixes:** S7, S11 and S17.
   - **Images:** B5 (Alpine 3.24, nginx 1.30, the official ClamAV image) and the `.dockerignore` and `postgresql-dev` fixes.

   This is mostly small, test-covered changes.
2. **Weeks 1–2, a real place to run (about a week):**
   - **Host and email:** B1 host and deploy, then B2 email.
   - **Production setup:** B10 production config, B9 backups, S13–S15 monitoring, logs and the support channel.
   - **Docs:** update the operator guide and README.

   Do B4 (privacy notice and consent) in parallel. It's writing more than code.
3. **Week 3, performance (3–5 days):** §2 items 1–7, then the Postgres CI job (S10) and the missing Playwright specs (S16).
4. **Then UX:** proposal 6 first (it carries the S1 fix), then 8, 1, 2, 4, 3, 5, 7 as time allows.

Items in step 1 that change behaviour need a decision from you before they're built:
- whether reserved usernames get the same migration treatment as roles (B3);
- whether to drop `DELETE /api/me` for S17;
- the image tags for B5.

---

## 6. What's strong and worth keeping

- **Queue job design:** jobs dispatch after commit, output paths are deterministic, and transcode and poster jobs never overlap. Timeouts sit below the retry window. Purges are made durable by a daily reconcile instead of month-long delayed jobs.
- **Media handling:** video streams end to end, uploads go straight to S3 in parts, and the quota is reserved by a single atomic UPDATE.
- **Authorization:** an explicit list of abilities admins don't get automatically, and ownership checks on playback. `CheckUserIsActive` guards the API, web and panel stacks. The MFA stamp is tied to the user id and cleared on every login.
- **Schema:** all 12 driver-branched tables match between Postgres and SQLite, with no drift. Foreign-key actions fit the erasure contract, and everything in the cascade chain is indexed. Timezones are consistent (UTC everywhere).
- **The SPA:**
  - 419 errors are retried after a CSRF refresh, and 401 errors return the user to login with their place kept.
  - Drafts are protected.
  - Every route has a loading state, and there are no placeholder screens.
  - Posters are properly optimised.
- **Observability:** correlation IDs on every request, GlitchTip wired in, and the Horizon dashboard behind MFA.

---

## 7. How this was checked, and corrections

**What the agents ran:**
- **Backend:** host benchmarks with `php -S`, opcache and `ab -n 300`; caches and storage were redirected to a scratch folder, and the scratch config cache was deleted afterwards.
- **Database:** compared every driver-branched migration, and ran migrate/reset on a throwaway SQLite file. That run found two `down()` methods that fail.
- **Frontend:** a `vite build` into a scratch folder, plus source-map attribution of the bundle.
- **Dependencies:** OSV.dev queries, because `composer audit` timed out against packagist; also registry manifests, endoflife.date and the GitHub releases API.
- **Readiness:** the public GitHub REST API, since `gh` isn't installed; job logs need admin rights.

The repo was left unmodified by all six.

**Claims I re-checked myself against the code (all held):**
- `Gate::before` has no MFA check;
- deploy only migrates, and signup assigns `member`;
- no legal routes;
- no environment guard in `E2ESeeder`;
- `backup.sh` skips the documents volume;
- ClamAV comes from Alpine 3.20 packages;
- `postgresql-dev` is never removed, and `php.ini-production` is never activated;
- `.dockerignore` gaps;
- no gzip;
- no `lazy()` routes;
- the 3 s poll on My speeches;
- `paginate(20)` with no page 2 in the SPA;
- case-sensitive `like`;
- no `deleted_at` filter on the timeline;
- erasure skips notifications and exports;
- the purge copy uses the draft-inclusive count;
- essay publish has no notification;
- onboarding goes to `/dashboard`;
- raw status badges;
- Horizon supervisor without tries or backoff;
- no `horizon:terminate` in deploy;
- only the login limiter;
- the 20 MB upload limits;
- all 31 interface labels used in the "Current" mockups.

**Corrections to agent findings:**
1. **"No long-lived cache headers"** is only half right. Admin panel assets already get `expires 1y, immutable` (`docker/nginx/default.conf:101-105`); it's the SPA's hashed `/assets/*` that get none.
2. **The deleted-speech timeline leak (S3)** is narrower than first reported. The timeline only shows the viewer's own link with that person, so the exposure is the other party to that review, not the public.
3. **The missing username-availability route (S19)** is a documented, deliberate deferral (`profileApi.ts:110-116`), not an oversight. The UI falls back to the check on submit.
4. **Panel MFA (from earlier notes)** is now enforced on the panel and Horizon (`RequireFilamentMfaChallenge.php`, `MfaStepUpTest.php`). The gap that remains is at the API layer (B7).
5. **The flaky roster-sort test** from 2026-10-30 is fixed, committed and pushed (`2819135`), and CI is green on it. The later master merge (`5c9d003`) failed at e2e on an identical tree, which is consistent with a flake. Its logs need admin access to confirm.

**Not verified:**
- anything that needs the running stack;
- actual Postgres runtime behaviour, which is inferred from driver semantics;
- behaviour in real browsers;
- upstream facts beyond what the registries returned on 2026-10-30;
- the terms of the free services named above;
- anything legal: this is an engineering review, not legal advice.
