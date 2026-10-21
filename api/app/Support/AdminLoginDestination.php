<?php

namespace App\Support;

use Filament\Facades\Filament;
use Filament\Pages\Page;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use LogicException;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/** Normalizes continuation data only; destination middleware still authorizes access. */
final class AdminLoginDestination
{
    public function __construct(private Router $router) {}

    public function resolve(mixed $intended): string
    {
        $origin = $this->origin();
        $panel = Filament::getDefaultPanel();
        $root = '/'.trim($panel->getPath(), '/');
        $fallback = $origin.$root;

        if (! is_string($intended) || $intended === '' || preg_match('/[\x00-\x20\x7f\\\\]/', $intended)
            || preg_match('/%(?![a-f0-9]{2})/i', $intended)) {
            return $fallback;
        }

        $parts = parse_url($intended);
        if ($parts === false || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])) {
            return $fallback;
        }

        if (isset($parts['scheme']) || isset($parts['host'])) {
            if (! isset($parts['scheme'], $parts['host']) || $this->urlOrigin($parts) !== $origin) {
                return $fallback;
            }
        } elseif (! str_starts_with($intended, '/') || str_starts_with($intended, '//')) {
            return $fallback;
        }

        $path = $parts['path'] ?? '/';
        // Decode each segment once. Percent signs after decoding indicate ambiguous/double encoding.
        $segments = explode('/', substr($path, 1));
        foreach ($segments as $segment) {
            $decoded = rawurldecode($segment);
            if ($decoded === '.' || $decoded === '..' || preg_match('/[\x00-\x20\x7f\/%?#]/', $decoded)) {
                return $fallback;
            }
        }
        $query = isset($parts['query']) ? '?'.$parts['query'] : '';
        if (preg_match('/[\x00-\x1f\x7f\\\\]/', rawurldecode($query))) {
            return $fallback;
        }

        try {
            // Route matching inspects metadata; no bindings, middleware, or controller executes here.
            $route = $this->router->getRoutes()->match(Request::create($origin.$path, 'GET'));
        } catch (NotFoundHttpException|MethodNotAllowedHttpException) {
            return $fallback;
        }

        $name = $route->getName() ?? '';
        $action = explode('@', $route->getActionName())[0];
        if (($path === $root || str_starts_with($path, $root.'/'))
            && (str_starts_with($name, 'filament.'.$panel->getId().'.pages.')
                || str_starts_with($name, 'filament.'.$panel->getId().'.resources.'))
            && is_subclass_of($action, Page::class)
            && ! str_contains(rawurldecode($path), '\\')) {
            return $origin.$path.$query;
        }

        if ($name === 'horizon.index' && ($normalized = $this->horizonPath($path)) !== null) {
            return $origin.$normalized.$query;
        }

        return $fallback;
    }

    private function origin(): string
    {
        $configured = config('app.url');
        $parts = is_string($configured) ? parse_url($configured) : false;
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])
            || ! in_array($parts['scheme'], ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])
            || ! in_array($parts['path'] ?? '', ['', '/'], true)
            || preg_match('/[\x00-\x20\x7f\\\\]/', $configured)
            || filter_var($configured, FILTER_VALIDATE_URL) === false) {
            throw new LogicException('app.url must be a valid trusted HTTP(S) API origin.');
        }

        return $this->urlOrigin($parts);
    }

    /** @param array<string, mixed> $parts */
    private function urlOrigin(array $parts): string
    {
        $scheme = strtolower($parts['scheme']);
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);

        return $scheme.'://'.strtolower($parts['host']).(($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80) ? '' : ':'.$port);
    }

    private function horizonPath(string $path): ?string
    {
        $root = '/'.trim((string) config('horizon.path', 'horizon'), '/');
        if ($path !== $root && ! str_starts_with($path, $root.'/')) {
            return null;
        }
        $suffix = substr($path, strlen($root));
        $segments = $suffix === '' || $suffix === '/' ? [] : explode('/', substr($suffix, 1));
        $count = count($segments);
        $section = $segments[0] ?? '';
        $allowed = $count === 0
            || ($count === 1 && in_array($section, ['dashboard', 'monitoring', 'metrics', 'failed', 'batches'], true))
            || ($section === 'monitoring' && ($count === 2 || ($count === 3 && in_array($segments[2], ['jobs', 'failed'], true))))
            || ($section === 'metrics' && in_array($segments[1] ?? '', ['jobs', 'queues'], true) && in_array($count, [2, 3], true))
            || ($section === 'jobs' && in_array($segments[1] ?? '', ['pending', 'completed', 'silenced'], true) && in_array($count, [2, 3], true))
            || (in_array($section, ['failed', 'batches'], true) && $count === 2);
        if (! $allowed) {
            return null;
        }

        foreach ($segments as $index => $segment) {
            $decoded = rawurldecode($segment);
            $opaque = ($section === 'monitoring' && $index === 1)
                || ($section === 'metrics' && $count === 3 && $index === 2)
                || (in_array($section, ['failed', 'batches'], true) && $index === 1)
                || ($section === 'jobs' && $index === 2);
            if ($decoded === '' || (! $opaque && $segment !== $decoded)
                || (! $opaque && str_contains($decoded, '\\'))) {
                return null;
            }
            // Backslashes are data only in an already verified opaque parameter.
            $segments[$index] = rawurlencode($decoded);
        }

        return $root.($count ? '/'.implode('/', $segments) : '');
    }
}
