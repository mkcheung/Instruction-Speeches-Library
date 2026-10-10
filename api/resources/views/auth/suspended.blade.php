{{--
    PLAN-ADMIN-DASHBOARD.md §5.1 — the HTML half of
    `App\Http\Middleware\CheckUserIsActive`'s response ("403 (JSON) or
    redirect to a suspension notice (HTML)"). Registered as
    `suspension.notice` in bootstrap/app.php's `withRouting(then: ...)`,
    beside the middleware registration, and listed in
    `CheckUserIsActive::EXEMPT_ROUTE_NAMES` so the redirect to it cannot
    loop back through the middleware that issued it.

    By the time this renders the visitor has already been logged out, their
    session invalidated and migrated, and their Sanctum tokens deleted —
    so there is deliberately no sign-out form here (there is nothing left
    to sign out of, and a CSRF-bearing form against a just-invalidated
    session is a reliable source of 419s). The only action offered is
    signing in again, which will simply fail for as long as the account
    stays inactive.

    The `reason` query parameter is never echoed. It is mapped through the
    whitelist below to fixed copy, so a crafted `?reason=` cannot inject
    anything, and an unrecognised value falls back to the suspended copy.

    ⚠️ §8.3: no Tailwind utility classes — `api/` has no node_modules and
    no `public/build`, and the Dockerfile builds `web/` only, so utility
    classes render unstyled. Inline CSS, mirroring errors/403.blade.php.
--}}
@php
    $reason = (string) request()->query('reason', '');

    $copy = [
        'suspended' => [
            'badge' => 'Account suspended',
            'heading' => 'Your account has been suspended',
            'body' => 'An administrator has suspended this account, so you have been signed out and
                       cannot use the platform for now. Suspension is reversible.',
            'next' => 'If you believe this is a mistake, reply to the email address you registered
                       with and an administrator will review it.',
        ],
        'deleted' => [
            'badge' => 'Account closed',
            'heading' => 'This account has been closed',
            'body' => 'An administrator has closed this account. You have been signed out and can no
                       longer use the platform.',
            'next' => 'Closed accounts are retained for a short grace period before removal, so if
                       this was a mistake, get in touch promptly.',
        ],
        'anonymized' => [
            'badge' => 'Account erased',
            'heading' => 'This account has been erased',
            'body' => 'This account completed an erasure request. Its personal data is gone and the
                       account can no longer be used to sign in.',
            'next' => 'Erasure is permanent and cannot be undone. You are welcome to register a new
                       account.',
        ],
    ];

    $notice = $copy[$reason] ?? $copy['suspended'];
    $frontendUrl = rtrim((string) config('app.frontend_url'), '/');
@endphp
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>{{ $notice['heading'] }} &middot; {{ config('app.name') }}</title>
    <style>
        :root {
            --bg: #f8fafc;
            --card: #ffffff;
            --border: #e2e8f0;
            --ink: #1e293b;
            --muted: #64748b;
            --brand: #4f46e5;
            --warn: #b45309;
            --warn-bg: #fffbeb;
            --warn-border: #fde68a;
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
                --warn: #fbbf24;
                --warn-bg: #27211040;
                --warn-border: #78350f;
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

        .badge {
            display: inline-block;
            margin: 0 0 12px;
            padding: 2px 10px;
            border: 1px solid var(--warn-border);
            border-radius: 999px;
            background: var(--warn-bg);
            color: var(--warn);
            font-size: 12px;
            font-weight: 600;
            letter-spacing: .06em;
            text-transform: uppercase;
        }

        h1 {
            margin: 0 0 12px;
            font-size: 24px;
            line-height: 1.3;
            font-weight: 650;
        }

        p { margin: 0 0 16px; color: var(--muted); }

        .hr { height: 1px; margin: 24px 0; background: var(--border); border: 0; }

        .next { font-size: 14px; }

        .btn {
            display: inline-block;
            margin-top: 8px;
            padding: 9px 16px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: transparent;
            color: var(--ink);
            font: inherit;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
        }

        .btn:hover { border-color: var(--brand); color: var(--brand); }
    </style>
</head>
<body>
    <main class="card">
        <p class="badge">{{ $notice['badge'] }}</p>
        <h1>{{ $notice['heading'] }}</h1>

        <p>{{ $notice['body'] }}</p>

        <hr class="hr">

        <p class="next">{{ $notice['next'] }}</p>

        @if ($frontendUrl !== '')
            <a class="btn" href="{{ $frontendUrl }}/login">Go to sign in</a>
        @endif
    </main>
</body>
</html>
