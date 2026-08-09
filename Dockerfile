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
# ffmpeg is new in S3, for App\Services\Transcoding\FfmpegTranscoder — it is
# a runtime binary shelled out to (via Illuminate\Support\Facades\Process),
# never a PHP extension, so it has no docker-php-ext-install step and needs
# no dev/runtime library split the way gd/zip/intl do above. This same image
# runs as both the `app` and `queue-worker` services (§21.4's "two
# containers, one image" lesson), so ffmpeg only needs to be installed once,
# here, for both.
RUN apk add --no-cache postgresql-dev libzip-dev libzip zip icu-dev icu-libs \
    libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev \
    libpng libjpeg-turbo libwebp freetype ffmpeg \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install pdo_pgsql opcache zip bcmath intl gd exif \
    && apk del --no-cache libzip-dev icu-dev libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev
WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html
COPY docker/php/opcache.ini /usr/local/etc/php/conf.d/zz-opcache.ini
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
USER www-data
EXPOSE 9000
CMD ["php-fpm"]

# ---- nginx: the `web` service. Serves the built SPA and proxies /api to app:9000 ----
FROM nginx:1.27-alpine AS nginx
COPY --from=webbuild /web/dist /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
