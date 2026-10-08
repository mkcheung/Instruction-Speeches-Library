{{--
    PLAN-ADMIN-DASHBOARD.md §8.1. `EnsureUserIsAdmin` calls `abort(403)`,
    and bootstrap/app.php's `shouldRenderJsonWhen(fn ($r) => $r->wantsJson())`
    means a plain browser navigation to /control-panel by a non-admin got
    Laravel's stock HTML 403 — no branding, no explanation, and in
    particular no hint that the most likely cause is being signed in with
    the wrong one of two accounts. Filament ships no error views and
    `resources/views/errors/` did not exist until this file.

    This view is Laravel's generic handler for ANY 403 that renders as
    HTML, not just the panel's, so the copy stays deliberately neutral
    about what was being accessed and only narrows via the
    `$isPanelRequest` branch below.

    ⚠️ §8.3: NO Tailwind utility classes. `api/` has the Tailwind
    scaffolding (package.json, vite.config.js) but no node_modules and no
    `public/build`, and the Dockerfile's webbuild stage builds `web/` only
    — there is no compiled CSS for this app at all. The two existing
    blades under resources/views/filament/ use utility classes and render
    completely unstyled today; none of the classes they use exists as a
    selector in Filament's shipped theme.css. Hence plain inline CSS,
    which needs no build step and cannot silently stop working.
--}}
@php
    /**
     * The panel declares its own logout route; Fortify's is root-mounted.
     * Posting to the wrong one 404s, so pick by path rather than guessing.
     */
    $isPanelRequest = request()->is('control-panel', 'control-panel/*');
    $logoutUrl = $isPanelRequest && \Illuminate\Support\Facades\Route::has('filament.admin.auth.logout')
        ? route('filament.admin.auth.logout')
        : (\Illuminate\Support\Facades\Route::has('logout') ? route('logout') : null);

    $currentUser = request()->user();
    $frontendUrl = rtrim((string) config('app.frontend_url'), '/');

    /**
     * `abort(403, 'reason')` messages in this codebase are all
     * developer-authored constants, never user input — safe to surface,
     * and the only explanation a visitor gets. The framework's default
     * message for a bare `abort(403)` is the useless string "Forbidden" /
     * "This action is unauthorized.", so those are suppressed.
     */
    $detail = isset($exception) ? trim((string) $exception->getMessage()) : '';
    $detail = in_array($detail, ['', 'Forbidden', 'This action is unauthorized.'], true) ? null : $detail;
@endphp
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Access denied &middot; {{ config('app.name') }}</title>
    <style>
        :root {
            --bg: #f8fafc;
            --card: #ffffff;
            --border: #e2e8f0;
            --ink: #1e293b;
            --muted: #64748b;
            --brand: #4f46e5;
            --brand-ink: #ffffff;
            --shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 8px 24px rgba(15, 23, 42, .06);
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0f172a;
                --card: #1e293b;
                --border: #334155;
                --ink: #f1f5f9;
                --muted: #94a3b8;
                --brand: #6366f1;
                --shadow: none;
            }
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: var(--bg);
            color: var(--ink);
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }

        .card {
            width: 100%;
            max-width: 32rem;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: var(--shadow);
            padding: 32px;
        }

        .status {
            display: inline-block;
            margin: 0 0 12px;
            padding: 2px 10px;
            border: 1px solid var(--border);
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: .06em;
            text-transform: uppercase;
            color: var(--muted);
        }

        h1 {
            margin: 0 0 12px;
            font-size: 24px;
            line-height: 1.3;
            font-weight: 650;
        }

        p { margin: 0 0 16px; color: var(--muted); }

        .detail {
            margin: 0 0 16px;
            padding: 12px 14px;
            border-left: 3px solid var(--brand);
            border-radius: 0 6px 6px 0;
            background: var(--bg);
            color: var(--ink);
            font-size: 14px;
        }

        .hr { height: 1px; margin: 24px 0; background: var(--border); border: 0; }

        h2 { margin: 0 0 8px; font-size: 15px; font-weight: 650; }

        .who { font-size: 14px; }

        .who strong { color: var(--ink); word-break: break-all; }

        .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 16px; }

        .btn {
            display: inline-block;
            padding: 9px 16px;
            border: 1px solid transparent;
            border-radius: 8px;
            background: var(--brand);
            color: var(--brand-ink);
            font: inherit;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
        }

        .btn:hover { filter: brightness(1.08); }

        .btn-secondary { background: transparent; border-color: var(--border); color: var(--ink); }

        form { margin: 0; }
    </style>
</head>
<body>
    <main class="card">
        <p class="status">Error 403</p>
        <h1>You don&rsquo;t have access to this page</h1>

        <p>
            @if ($isPanelRequest)
                The control panel is restricted to administrator accounts. Nothing is wrong with
                your account &mdash; it simply isn&rsquo;t an administrator one.
            @else
                This page is restricted, and the account you&rsquo;re signed in with isn&rsquo;t
                permitted to view it.
            @endif
        </p>

        @if ($detail)
            <p class="detail">{{ $detail }}</p>
        @endif

        <hr class="hr">

        <h2>You may be signed in with the wrong account</h2>
        <p class="who">
            @if ($currentUser)
                This browser is currently signed in as <strong>{{ $currentUser->email }}</strong>.
                If you hold a second account with the access you need, sign out and sign back in as
                that one.
            @else
                This browser isn&rsquo;t signed in at all right now. If you have an account with the
                access you need, sign in with it and try again.
            @endif
        </p>

        <div class="actions">
            @if ($currentUser && $logoutUrl)
                <form method="POST" action="{{ $logoutUrl }}">
                    @csrf
                    <button type="submit" class="btn">Sign out</button>
                </form>
            @endif

            @if ($frontendUrl !== '')
                <a class="btn btn-secondary" href="{{ $frontendUrl }}">
                    {{ $currentUser ? 'Back to the app' : 'Go to sign in' }}
                </a>
            @endif
        </div>
    </main>
</body>
</html>
