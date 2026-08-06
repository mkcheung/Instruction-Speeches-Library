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
# libzip and icu-libs are the RUNTIME shared libraries the zip/intl
# extensions dlopen() at boot — `apk del ...-dev` below only removes the
# build-time headers, never these, or php -m silently loses the extension
# (caught by actually running the container, not just building the image).
RUN apk add --no-cache postgresql-dev libzip-dev libzip zip icu-dev icu-libs \
    && docker-php-ext-install pdo_pgsql opcache zip bcmath intl \
    && apk del --no-cache libzip-dev icu-dev
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
