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
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist
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
FROM php:8.4-fpm-alpine AS runtime
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
FROM alpine:3.20 AS whisper-build
RUN apk add --no-cache build-base cmake git
WORKDIR /build
# Pinned to a tag, not a moving branch — a floating `master` checkout would
# make this build (and therefore the `whisper-cli` binary's behavior)
# non-reproducible between two people running `docker compose build` on
# different days.
RUN git clone --branch v1.7.2 --depth 1 https://github.com/ggerganov/whisper.cpp.git .
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release --target whisper-cli -j"$(nproc)"

# ---- whisper-worker: the `whisper-worker` compose service ONLY. ----------
# Built FROM `runtime`, not fresh from `alpine`/`php:8.4-fpm-alpine`: same
# reasoning as `ffmpeg-worker` immediately above — it wants the same PHP/
# artisan/queue:work environment as the other workers, it's still a
# Laravel queue worker process, just with `whisper-cli` added. Only the
# compiled binary is copied in from `whisper-build`, not that stage's
# build toolchain — keeps this final layer as slim as `ffmpeg-worker`'s.
#
# `libgomp` is whisper-cli's OpenMP runtime dependency (linked at build
# time by the default CPU backend) — without it present in THIS layer
# (distinct from the build stage, which has its own via build-base), the
# binary fails to start with a missing-shared-library error.
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
RUN apk add --no-cache libgomp ffmpeg
COPY --from=whisper-build /build/build/bin/whisper-cli /usr/local/bin/whisper-cli
USER www-data

# ---- nginx: the `web` service. Serves the built SPA and proxies /api to app:9000 ----
FROM nginx:1.27-alpine AS nginx
COPY --from=webbuild /web/dist /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
