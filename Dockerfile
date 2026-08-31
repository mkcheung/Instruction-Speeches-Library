# Multi-stage build for the api/ (Laravel 13) + web/ (Vite/React 19) monorepo.
# Hand-written per MODERNIZATION_PLAN.md §21 — not laravel/sail. The point of
# this file is to be readable in full, so read it in full before changing it.
#
# Stages:
#   vendor   -> installs Composer dependencies against composer.json/lock only,
#               so editing app source never invalidates this layer.
#   webbuild -> builds the production Vite bundle, same caching discipline
#               against package.json/package-lock.json.
#   runtime  -> php-fpm image that actually serves requests (the `app` service).
#   nginx    -> nginx image that serves the built SPA and fastcgi_pass's /api
#               to `app:9000` (the `web` service).
#
# Vite's *dev server* is deliberately NOT containerized (§21.2) — HMR through
# a bind mount on Docker Desktop for Mac is the single most painful part of a
# containerized JS workflow, and the dev server proxies to the API like a
# browser would, so it needs nothing from the compose network. Only the
# production build is containerized, in the `webbuild` stage below.

# ---- composer deps (cached unless api/composer.json|lock changes) ----
FROM composer:2 AS vendor
WORKDIR /app
COPY api/composer.json api/composer.lock ./
# `--ignore-platform-req=ext-intl`: the official `composer:2` image is a bare
# installer with no PHP extensions beyond the core set — it doesn't bundle
# `intl`, which `filament/support` (STEP-12) requires. This stage only
# resolves/installs *files*, it never executes application code, so the
# extension doesn't need to be physically present here — only where the
# code actually runs. The `runtime` stage below installs `intl` for real
# (`docker-php-ext-install ... intl ...`), so every image built FROM it
# (ffmpeg-worker/whisper-worker/whisper-smoke included) genuinely has it at
# execution time. Confirmed by reproducing this exact failure with a local
# `composer install` against the `composer:2` image before adding the flag.
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --ignore-platform-req=ext-intl
COPY api/ .
RUN composer dump-autoload --optimize --no-dev

# ---- SPA production build (cached unless web/package.json|lock changes) ----
FROM node:22-alpine AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
# Empty VITE_API_URL bakes in a relative `/api/...` fetch base — correct here
# because nginx (the `nginx` stage below) serves this bundle and proxies
# /api to app:9000 on the SAME origin, so no CORS is needed for the
# containerized build. VITE_ENABLE_SPIKES is irrelevant to this stage: Vite
# sets import.meta.env.DEV=false for a production build regardless, so
# /__spikes 404s here by construction — it is only reachable through the
# host-run `npm run dev` server, which is the intended dev-only path.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---- php-fpm runtime: the `app` service ----
# Pinned to the `-alpine3.20` variant tag, not the floating `8.4-fpm-alpine`
# tag (which resolves to Alpine 3.24 as of this writing) — STEP-09
# verification plan §6.1 requires the build stage and this runtime stage to
# sit on the SAME Alpine minor version so a shared library compiled in
# `whisper-build` (alpine:3.20) is ABI-compatible with what ships in the
# `whisper-worker` layer built FROM this stage. Re-verify both tags still
# resolve to the same `VERSION_ID` (`docker run --rm <tag> cat
# /etc/os-release`) before bumping either independently. No image in this
# Dockerfile is pinned by digest today (grep confirms), so this follows the
# existing tag-pinning convention rather than introducing a new one; at the
# time this was written the two tags resolved to
# php@sha256:0bc1be153ede95ff777ebfd0850be6233975e3d11fc0a2a660d2c55777f4fb5a
# and alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
# respectively, both Alpine 3.20.6.
FROM php:8.4-fpm-alpine3.20 AS runtime
# libzip, icu-libs, libpng, libjpeg-turbo, libwebp and freetype are the
# RUNTIME shared libraries the zip/intl/gd extensions dlopen() at boot —
# `apk del ...-dev` below only removes the build-time headers, never these,
# because each runtime lib is ALSO named explicitly in the `apk add` below
# (S0's retrospective: omitting that step let Alpine autoremove libzip as an
# orphaned dependency of libzip-dev once nothing else needed it, and the
# zip/intl extensions failed to load despite a clean build — this only
# surfaces by running the container and checking `php -m`, not by building
# the image).
#
# gd + exif are new in S1, for App\Services\AvatarProcessor's EXIF-stripping
# re-encode (STEP-01-identity.md): decode-then-re-encode via GD is what
# actually guarantees the GPS EXIF block is gone, not selective tag
# deletion, and exif_read_data() (ext-exif) is what the feature test reads
# the re-encoded file back with to prove it.
#
# ffmpeg was here in S3 (installed alongside these libs, shared by `app` and
# `queue-worker`). STEP-04 moves it OUT of this stage entirely: only
# App\Services\Transcoding\FfmpegTranscoder shells out to it (verified by
# grepping api/app for `ffmpeg`/`ffprobe` — AppServiceProvider binds
# FakeTranscoder outside the real transcode worker, so neither `app` nor the
# default-queue `queue-worker` ever calls the real binary), and Alpine's own
# `apk info -a ffmpeg` build config shows `--enable-gpl --enable-libx264`
# (verified directly: `docker run --rm alpine:3.20 sh -c "apk add ffmpeg &&
# ffmpeg -version"` prints that exact configure line) — i.e. this is a GPL
# binary the same way Debian's is, not an LGPL-only build. §5.6/§9.2's
# GPL-isolation mitigation (own container, built from a distro package,
# never pushed to a registry) only means anything if the `app`/`web` images
# never carry the binary in the first place. See the `ffmpeg-worker` stage
# below for where it now lives.
RUN apk add --no-cache postgresql-dev libzip-dev libzip zip icu-dev icu-libs \
    libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev \
    libpng libjpeg-turbo libwebp freetype \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install pdo_pgsql opcache zip bcmath intl gd exif \
    && apk del --no-cache libzip-dev icu-dev libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev
WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html
COPY docker/php/opcache.ini /usr/local/etc/php/conf.d/zz-opcache.ini
COPY docker/php/uploads.ini /usr/local/etc/php/conf.d/zz-uploads.ini
# Overrides the stock pool's pm.max_children=5 — see the file's own comment
# for why five is too few even for one user on the watch page.
COPY docker/php/www-pool.conf /usr/local/etc/php-fpm.d/zz-www-pool.conf
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
USER www-data
EXPOSE 9000
CMD ["php-fpm"]

# ---- ffmpeg-worker: the `ffmpeg-worker` compose service ONLY. -------------
# GPL boundary (§5.6, §9.2, MODERNIZATION_PLAN.md §12.3/§21): FFmpeg built
# with `--enable-gpl` (required for libx264, which this pipeline needs for
# H.264 encoding) is GPL-licensed. GPL obligations trigger on DISTRIBUTING
# the binary, not on running it, so the mitigation is: keep it in its own
# image, built from a distro package (apk, same as before — confirmed above
# that Alpine's `ffmpeg` package is already `--enable-gpl --enable-libx264`,
# so there is no "safer" apk build to switch to; isolation is the only lever
# here), and NEVER PUSH THIS IMAGE TO A REGISTRY.
#
# >>> THIS IMAGE MUST NEVER BE PUSHED TO A REGISTRY. <<<
# As of this stage's addition, .github/workflows/ci.yml and deploy.yml push
# nothing anywhere (deploy.yml rsyncs api/ source and builds on the target
# host; ci.yml only runs `docker compose up --build` locally to the runner)
# — so there is no existing guardrail this could slip through today. If a
# future change adds `docker push`/`docker/build-push-action` or any
# registry step, it MUST explicitly exclude the `ffmpeg-worker` target/tag,
# or this GPL boundary silently breaks.
#
# Built FROM `runtime`, not fresh from php:8.4-fpm-alpine: it wants the same
# PHP/artisan/queue:work environment as the other workers (it's still a
# Laravel queue worker process, just with ffmpeg added), and this stage is
# already local-only/never-pushed, so there's no distribution-surface reason
# to slim it down further.
FROM runtime AS ffmpeg-worker
USER root
RUN apk add --no-cache ffmpeg
USER www-data

# ---- whisper-cli build: compiles whisper.cpp's CLI, nothing else. --------
# A SEPARATE build stage (not reused from `vendor`/`runtime`) so the C++
# toolchain (build-base, cmake, git) it needs never has to touch the final
# `whisper-worker` layer below — only the resulting `whisper-cli` binary is
# copied out of this stage (STEP-09-captions.md / the frozen STEP-09
# backend contract §6: "adds a build stage that compiles whisper.cpp's CLI
# ... and copies only the resulting binary into the final layer").
#
# `faster-whisper` (Python + CTranslate2) was considered and rejected —
# see the frozen contract §6 for the full reasoning (no prebuilt musl/
# Alpine wheels, doesn't fit this Dockerfile's all-stages-share-one-PHP-
# base shape the way `apk add ffmpeg` did). whisper.cpp is a self-
# contained C++ binary, buildable from source with a standard Alpine
# `build-base`/`cmake` toolchain, closer in shape to the ffmpeg precedent
# immediately above.
#
# whisper.cpp itself is MIT-licensed (unlike ffmpeg's `--enable-gpl`
# build above) — no GPL-isolation reasoning applies to THIS stage. The
# model WEIGHTS carry their own, separate license terms — see the
# `whisper-worker` service block in compose.yaml for that license-boundary
# comment; nothing about weights belongs in this image-build stage at all,
# since they are mounted as a volume, never baked in (STEP-09.md: "mount
# them as a volume rather than baking them into the image").
# Pinned to the exact commit tagged v1.7.2, not a moving branch or a
# `git clone --branch` (STEP-09 verification plan §6.1: "A SHA is not a
# valid replacement for `git clone --branch`" — a branch/tag clone still
# trusts whatever GitHub currently serves for that ref name, which is
# mutable). Instead this does a minimal shallow fetch of the exact commit
# object and a detached checkout, then asserts `git rev-parse HEAD` matches
# byte-for-byte before the build proceeds — GitHub allows fetching a
# specific commit SHA directly (verified: `git fetch --depth 1 origin
# <sha>` succeeds against this repo without needing a branch/tag ref).
FROM alpine:3.20 AS whisper-build
RUN apk add --no-cache build-base cmake git
WORKDIR /build
ARG WHISPER_CPP_COMMIT=6266a9f9e56a5b925e9892acf650f3eb1245814d
RUN git init -q \
    && git remote add origin https://github.com/ggerganov/whisper.cpp.git \
    && git fetch --depth 1 origin "${WHISPER_CPP_COMMIT}" \
    && git checkout -q FETCH_HEAD \
    && actual="$(git rev-parse HEAD)" \
    && if [ "$actual" != "${WHISPER_CPP_COMMIT}" ]; then \
         echo "whisper.cpp commit mismatch: expected ${WHISPER_CPP_COMMIT}, got $actual" >&2; \
         exit 1; \
       fi
# -DBUILD_SHARED_LIBS=OFF: STEP-09 verification plan §6.1's stated
# preference (static linking) — upstream v1.7.2's CMakeLists.txt defaults
# BUILD_SHARED_LIBS to ON on Linux (non-MinGW/non-Emscripten), which is why
# the prior version of this stage silently produced a CLI binary that
# dlopen()s libwhisper/libggml .so files never copied into the runtime
# layer. WHISPER_BUILD_EXAMPLES stays ON because the CLI is built as an
# example target, not part of the core library (confirmed by reading
# upstream CMakeLists.txt: `option(WHISPER_BUILD_EXAMPLES ... ${WHISPER_STANDALONE})`).
# WHISPER_BUILD_TESTS/WHISPER_BUILD_SERVER are turned off — this image never
# runs either, and skipping them shortens the build.
#
# The build TARGET at this exact pinned commit is named `main`, not
# `whisper-cli` — verified by reading examples/CMakeLists.txt and
# examples/main/CMakeLists.txt at commit 6266a9f9e5 (`set(TARGET main)`,
# `add_executable(${TARGET} main.cpp)`) and by actually building it in this
# sandbox: `cmake --build build --target help` lists `main`, and
# `--target whisper-cli` fails with "No rule to make target". Upstream
# renamed this example to `whisper-cli` in a LATER commit than the one this
# Dockerfile pins to, so building `--target whisper-cli` against v1.7.2's
# exact tagged commit does not work. The binary is renamed to `whisper-cli`
# at COPY time below so `api/config/captions.php`'s
# `WHISPER_BINARY=/usr/local/bin/whisper-cli` default needs no change.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DWHISPER_BUILD_EXAMPLES=ON \
        -DWHISPER_BUILD_TESTS=OFF \
        -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build build --config Release --target main -j"$(nproc)"

# ---- whisper-worker: the `whisper-worker` compose service ONLY. ----------
# Built FROM `runtime`, not fresh from `alpine`/`php:8.4-fpm-alpine`: same
# reasoning as `ffmpeg-worker` immediately above — it wants the same PHP/
# artisan/queue:work environment as the other workers, it's still a
# Laravel queue worker process, just with `whisper-cli` added. Only the
# compiled binary is copied in from `whisper-build`, not that stage's
# build toolchain — keeps this final layer as slim as `ffmpeg-worker`'s.
#
# `-DBUILD_SHARED_LIBS=OFF` above makes libwhisper/libggml themselves
# static (no longer part of `ldd`'s output), but the binary still
# dynamically links its C/C++ runtime deps — confirmed by actually building
# it in this sandbox and running `ldd` against the output: `libgomp.so.1`
# (OpenMP runtime, linked by ggml's default CPU backend),
# `libstdc++.so.6`, and `libgcc_s.so.1`. GCC does not statically link
# libgomp/libstdc++/libgcc by default (that needs explicit
# `-static-libgomp -static-libstdc++ -static-libgcc`, not set here), so all
# three packages are required in this layer or the binary fails to start
# with a missing-shared-library error. `libstdc++`/`libgcc` are NOT pulled
# in transitively by the `libgomp` apk package alone — verified directly:
# installing only `libgomp` in a fresh alpine:3.20 container leaves
# `libstdc++.so.6`/`libgcc_s.so.1` absent from the filesystem.
#
# Model weights are NOT baked into this image anywhere — see the
# `whisper-worker` compose service for the `whisper-models` read-only
# named-volume mount and its license-boundary comment.
#
# >>> This stage also `apk add`s `ffmpeg` (WhisperTranscriber extracts a
# >>> 16kHz mono WAV before handing audio to whisper-cli) — the SAME GPL
# >>> boundary as `ffmpeg-worker` above therefore applies here too: THIS
# >>> IMAGE MUST NEVER BE PUSHED TO A REGISTRY either.
FROM runtime AS whisper-worker
USER root
RUN apk add --no-cache libgomp libstdc++ libgcc ffmpeg
# The build target at the pinned commit produces a binary named `main`
# (see the whisper-build stage's comment above) — renamed to `whisper-cli`
# here so `api/config/captions.php`'s `WHISPER_BINARY` default
# (`/usr/local/bin/whisper-cli`) resolves without any app-side change.
COPY --from=whisper-build /build/build/bin/main /usr/local/bin/whisper-cli
# Same fixed in-image path `whisper-model-init` already uses for this exact
# file (see that stage below) — STEP-09 verification plan §6.2/§6.3 need to
# read the locked engine+weights `model_id` at RUNTIME (to assert a
# transcript's `model` column matches it), and this is the only stage of
# the three (`whisper-worker`, `whisper-smoke`, `whisper-model-init`) that
# didn't already carry the file. `WHISPER_MODEL_LOCK` (config/captions.php)
# points here by default so the app never needs a repo-relative path that
# wouldn't exist inside a container at all.
COPY docker/whisper/model.lock /docker/whisper/model.lock
USER www-data

# ---- vendor-dev: composer deps WITH dev packages (Pest, etc). ------------
# STEP-09 verification plan §6.2: the production `vendor` stage above runs
# `composer install --no-dev`, so plain `whisper-worker` has no Pest/
# phpunit/mockery — `php artisan test` cannot truthfully run against it.
# This is a SEPARATE stage (not a flag change to `vendor`) precisely so
# `runtime`/`ffmpeg-worker`/`whisper-worker` — every image that IS allowed
# to run in production — never gains a single dev dependency; only
# `whisper-smoke` below ever copies anything out of this stage.
FROM composer:2 AS vendor-dev
WORKDIR /app
COPY api/composer.json api/composer.lock ./
# See the `vendor` stage's own comment above for why `--ignore-platform-req=
# ext-intl` is correct here too: `composer:2` never executes app code, and
# every image built FROM `runtime` (which this stage's output ultimately
# layers onto, via `whisper-smoke`) has `intl` installed for real.
RUN composer install --no-scripts --no-autoloader --prefer-dist --ignore-platform-req=ext-intl
COPY api/ .
RUN composer dump-autoload --optimize

# ---- whisper-smoke: the `whisper-smoke` compose service ONLY. ------------
# STEP-09 verification plan §6.2: "Add a `whisper-smoke` Docker target
# based on `whisper-worker` with dev Composer dependencies and
# `pdo_sqlite` solely for the smoke test... The production worker
# currently has `--no-dev` dependencies, so `php artisan test` cannot
# truthfully be proposed against that image without this target/service."
#
# Built FROM `whisper-worker` (not `runtime`) so it inherits the real
# `whisper-cli` binary and `ffmpeg` — this image runs
# `RealWhisperAdapterSmokeTest` (api/tests/Feature/Captions) against the
# ACTUAL compiled whisper.cpp binary and a real mounted model file, never
# `FakeCaptionTranscriber`.
#
# `pdo_sqlite` is added only here: the production images never need it
# (Postgres-only, `pdo_pgsql` already in `runtime`), and SQLite is what
# this smoke test's own isolation contract requires (§6.2 item 1: "uses
# SQLite and `Storage::fake('media')` for isolation").
#
# NEVER pushed to a registry either — inherits `whisper-worker`'s GPL
# (ffmpeg) isolation boundary unchanged; this stage adds no new
# distribution surface, just dev tooling on top.
FROM whisper-worker AS whisper-smoke
USER root
RUN apk add --no-cache sqlite-dev \
    && docker-php-ext-install pdo_sqlite \
    && apk del --no-cache sqlite-dev \
    && apk add --no-cache sqlite-libs
COPY --from=vendor-dev /app/vendor /var/www/html/vendor
# The committed fixture/README under api/tests/fixtures/whisper-smoke are
# already present via `runtime`'s `COPY --from=vendor /app ...` (the
# production `vendor` stage's `COPY api/ .` grabs the whole api/ tree,
# tests/ included — only the Composer PACKAGES differ between `--no-dev`
# and this stage's full install). This COPY only needs to replace the
# vendor/ directory itself with one that actually contains Pest et al.
RUN chown -R www-data:www-data /var/www/html/vendor
# `runtime`'s `bootstrap/cache/packages.php`/`services.php` were generated
# by the `vendor` stage's `--no-dev` composer install, so they list
# whatever service providers non-dev packages register — NOT
# pestphp/pest-plugin's, which is what actually registers `php artisan
# test`. Without regenerating this cache against the dev-inclusive vendor/
# just copied in above, `php artisan test` fails with "Command test is
# not defined" despite Pest genuinely being on disk — caught by actually
# running this exact command against a real build in this stage's own
# verification, not by reading the Dockerfile.
RUN php artisan package:discover --ansi
USER www-data

# ---- whisper-model-init: the `whisper-model-init` compose profile/service ----
# STEP-09 verification plan §6.1, item 4. A tiny, throwaway image whose only
# job is to run docker/whisper/init-model.sh against the RW `whisper-models`
# volume mount defined for THIS service in compose.yaml (never the same
# mount as `whisper-worker`'s, which stays read-only — see that service's
# comment). Built from `alpine`, not `runtime`: it has nothing to do with
# PHP/Laravel and pulling in the whole runtime layer for `curl`+`jq` would
# be pure waste. Not reused from `whisper-build` either — that stage carries
# a full C++ toolchain this only-ever-downloads-a-file service does not
# need.
FROM alpine:3.20 AS whisper-model-init
RUN apk add --no-cache curl jq
COPY docker/whisper/init-model.sh /usr/local/bin/init-model.sh
COPY docker/whisper/model.lock /docker/whisper/model.lock
RUN chmod +x /usr/local/bin/init-model.sh
ENTRYPOINT ["/usr/local/bin/init-model.sh"]

# ---- clamav: the `clamav` compose service ONLY. -------------------------
# STEP-12-admin-portal.md / STEP-12-FROZEN-CONTRACT.md §7: `clamd` (the
# long-running daemon), not one-shot `clamscan` — App\Services\Scanning\
# ClamdScanner talks to a warm, already-signature-loaded socket repeatedly
# from the queued `App\Jobs\ScanApplicationDocument` job, rather than
# paying signature-load cost per document. Built from a distro (apk)
# package like ffmpeg/whisper.cpp above, but ClamAV is GPL-2.0 licensed
# top-to-bottom (not just a build flag like ffmpeg's `--enable-gpl`) — same
# isolation reasoning applies: own image, never pushed to a registry (see
# the ffmpeg-worker stage's own note; nothing in this repo's CI pushes
# images at all today).
#
# `freshclam` runs once at image build time to seed a signature database
# baked into the image (so the container has SOMETHING to scan against
# immediately on first boot), and again at container start via the
# `clamav-entrypoint.sh` wrapper before `clamd` itself starts — freshclam's
# database load is exactly the "genuinely slow startup" this step's own
# healthcheck (compose.yaml) exists to wait out.
FROM alpine:3.20 AS clamav
RUN apk add --no-cache clamav clamav-daemon
COPY docker/clamav/clamd.conf /etc/clamav/clamd.conf
COPY docker/clamav/entrypoint.sh /usr/local/bin/clamav-entrypoint.sh
RUN chmod +x /usr/local/bin/clamav-entrypoint.sh \
    && mkdir -p /var/lib/clamav \
    && freshclam --config-file=/etc/clamav/freshclam.conf || true
EXPOSE 3310
ENTRYPOINT ["/usr/local/bin/clamav-entrypoint.sh"]

# ---- nginx: the `web` service. Serves the built SPA and proxies /api to app:9000 ----
FROM nginx:1.27-alpine AS nginx
COPY --from=webbuild /web/dist /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
