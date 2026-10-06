<?php

use Illuminate\Support\Str;

return [

    /*
    |--------------------------------------------------------------------------
    | Horizon Name
    |--------------------------------------------------------------------------
    |
    | This name appears in notifications and in the Horizon UI. Unique names
    | can be useful while running multiple instances of Horizon within an
    | application, allowing you to identify the Horizon you're viewing.
    |
    */

    'name' => env('HORIZON_NAME'),

    /*
    |--------------------------------------------------------------------------
    | Horizon Domain
    |--------------------------------------------------------------------------
    |
    | This is the subdomain where Horizon will be accessible from. If this
    | setting is null, Horizon will reside under the same domain as the
    | application. Otherwise, this value will serve as the subdomain.
    |
    */

    'domain' => env('HORIZON_DOMAIN'),

    /*
    |--------------------------------------------------------------------------
    | Horizon Path
    |--------------------------------------------------------------------------
    |
    | This is the URI path where Horizon will be accessible from. Feel free
    | to change this path to anything you like. Note that the URI will not
    | affect the paths of its internal API that aren't exposed to users.
    |
    */

    'path' => env('HORIZON_PATH', 'horizon'),

    /*
    |--------------------------------------------------------------------------
    | Horizon Redis Connection
    |--------------------------------------------------------------------------
    |
    | This is the name of the Redis connection where Horizon will store the
    | meta information required for it to function. It includes the list
    | of supervisors, failed jobs, job metrics, and other information.
    |
    */

    'use' => 'default',

    /*
    |--------------------------------------------------------------------------
    | Horizon Redis Prefix
    |--------------------------------------------------------------------------
    |
    | This prefix will be used when storing all Horizon data in Redis. You
    | may modify the prefix when you are running multiple installations
    | of Horizon on the same server so that they don't have problems.
    |
    */

    'prefix' => env(
        'HORIZON_PREFIX',
        Str::slug((string) env('APP_NAME', 'laravel'), '_').'_horizon:'
    ),

    /*
    |--------------------------------------------------------------------------
    | Horizon Route Middleware
    |--------------------------------------------------------------------------
    |
    | These middleware will get attached onto each Horizon route, giving you
    | the chance to add your own middleware to this list or change any of
    | the existing middleware. Or, you can simply stick with this list.
    |
    */

    'middleware' => ['web'],

    /*
    |--------------------------------------------------------------------------
    | Queue Wait Time Thresholds
    |--------------------------------------------------------------------------
    |
    | This option allows you to configure when the LongWaitDetected event
    | will be fired. Every connection / queue combination may have its
    | own, unique threshold (in seconds) before this event is fired.
    |
    */

    'waits' => [
        'redis:default' => 60,
    ],

    /*
    |--------------------------------------------------------------------------
    | Job Trimming Times
    |--------------------------------------------------------------------------
    |
    | Here you can configure for how long (in minutes) you desire Horizon to
    | persist the recent and failed jobs. Typically, recent jobs are kept
    | for one hour while all failed jobs are stored for an entire week.
    |
    */

    'trim' => [
        'recent' => 60,
        'pending' => 60,
        'completed' => 60,
        'recent_failed' => 10080,
        'failed' => 10080,
        'monitored' => 10080,
    ],

    /*
    |--------------------------------------------------------------------------
    | Silenced Jobs
    |--------------------------------------------------------------------------
    |
    | Silencing a job will instruct Horizon to not place the job in the list
    | of completed jobs within the Horizon dashboard. This setting may be
    | used to fully remove any noisy jobs from the completed jobs list.
    |
    */

    'silenced' => [
        // App\Jobs\ExampleJob::class,
    ],

    'silenced_tags' => [
        // 'notifications',
    ],

    /*
    |--------------------------------------------------------------------------
    | Metrics
    |--------------------------------------------------------------------------
    |
    | Here you can configure how many snapshots should be kept to display in
    | the metrics graph. This will get used in combination with Horizon's
    | `horizon:snapshot` schedule to define how long to retain metrics.
    |
    */

    'metrics' => [
        'trim_snapshots' => [
            'job' => 24,
            'queue' => 24,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Fast Termination
    |--------------------------------------------------------------------------
    |
    | When this option is enabled, Horizon's "terminate" command will not
    | wait on all of the workers to terminate unless the --wait option
    | is provided. Fast termination can shorten deployment delay by
    | allowing a new instance of Horizon to start while the last
    | instance will continue to terminate each of its workers.
    |
    */

    'fast_termination' => false,

    /*
    |--------------------------------------------------------------------------
    | Memory Limit (MB)
    |--------------------------------------------------------------------------
    |
    | This value describes the maximum amount of memory the Horizon master
    | supervisor may consume before it is terminated and restarted. For
    | configuring these limits on your workers, see the next section.
    |
    */

    'memory_limit' => 64,

    /*
    |--------------------------------------------------------------------------
    | Queue Worker Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may define the queue worker settings used by your application
    | in all environments. These supervisors and settings handle all your
    | queued jobs and will be provisioned by Horizon during deployment.
    |
    */

    // STEP-14-deploy-hardening.md: these three supervisors mirror
    // compose.yaml's `queue-worker`/`ffmpeg-worker`/`whisper-worker`
    // services, which now run `php artisan horizon --environment=...`
    // instead of `queue:work` (STEP-14 validation pass) — faithfully
    // reproducing their former `--queue`/`--timeout`/`--tries`/`--sleep`/
    // `nice` arguments.
    //
    // `defaults` is deliberately EMPTY, not the flat option list an earlier
    // draft had here. `ProvisioningPlan::applyDefaultOptions()` merges this
    // array with `array_replace_recursive()` keyed by SUPERVISOR NAME (see
    // the vendor stub, `vendor/laravel/horizon/config/horizon.php`:
    // `'defaults' => ['supervisor-1' => [...]]`) — a flat list of bare
    // option names (`'balance' => 'simple'`, etc.) has no key matching any
    // real supervisor name, so `array_replace_recursive` left them as
    // SIBLINGS of `supervisor-default`/etc. in the merged plan, and
    // `toSupervisorOptions()` then iterated every one of those stray keys
    // AS IF it were its own supervisor — producing the exact "Undefined
    // array key 'connection'" crash this comment replaces, caught only by
    // actually starting the worker containers and reading their logs, not
    // by reading this file. Every option `SupervisorOptions` doesn't
    // receive explicitly already has a sane class-level default (`$balance
    // = 'off'`, etc.) — each of the three supervisors below is already a
    // complete, self-contained definition, so there is nothing left for a
    // correctly-shaped `defaults` block to usefully contribute here.
    'defaults' => [],

    // ⚠️ Deliberately THREE separate environment keys per stage (default/
    // transcode/captions), not one `production` key holding all three
    // supervisors. `php artisan horizon` runs every supervisor defined in
    // whichever environment key it's pointed at, in-process, as children of
    // the container that issued the command. `ffmpeg-worker` and
    // `whisper-worker` are their OWN images specifically so the GPL-licensed
    // `ffmpeg` binary and the whisper.cpp binary never have to be present in
    // the plain `app` image (see the Dockerfile's `ffmpeg-worker` stage
    // comment: "THIS IMAGE MUST NEVER BE PUSHED TO A REGISTRY"). A single
    // merged environment would make the `app`-based `queue-worker` container
    // try to supervise the transcode queue too — and silently fail every
    // job the moment it tried to shell out to a binary that isn't there.
    // One environment key per container preserves that isolation: each
    // container's `--environment=` flag (compose.yaml) selects only its own
    // supervisor, so Horizon in `queue-worker` never attempts a job that
    // needs `ffmpeg-worker`'s or `whisper-worker`'s binary.
    'environments' => [
        'production-default' => [
            // Mirrors `queue-worker`'s former `queue:work --queue=default
            // --timeout=60 --sleep=1 --tries=1` on the default `redis`
            // connection.
            'supervisor-default' => [
                'connection' => 'redis',
                'queue' => ['default'],
                'timeout' => 60,
            ],
        ],

        'production-transcode' => [
            // Mirrors `ffmpeg-worker`'s former `queue:work redis-long
            // --queue=transcode --timeout=3700 --tries=1 --sleep=1`,
            // `nice -n 19`. Concurrency stays at the shared default of 1 —
            // §15's "the concurrency-1 transcode worker is the component
            // that genuinely does not scale" is a deliberate commitment,
            // not a gap to size up here.
            'supervisor-transcode' => [
                'connection' => 'redis-long',
                'queue' => ['transcode'],
                'timeout' => 3700,
                'nice' => 19,
            ],
        ],

        'production-captions' => [
            // Mirrors `whisper-worker`'s former `queue:work redis-long
            // --queue=captions --timeout=1800 --tries=1 --sleep=1`,
            // `nice -n 19`. Same `redis-long` CONNECTION as transcode above
            // (config/queue.php: only `retry_after` differs between
            // `redis`/`redis-long`) but a genuinely distinct QUEUE NAME.
            'supervisor-captions' => [
                'connection' => 'redis-long',
                'queue' => ['captions'],
                'timeout' => 1800,
                'nice' => 19,
            ],
        ],

        'local-default' => [
            'supervisor-default' => [
                'connection' => 'redis',
                'queue' => ['default'],
                'timeout' => 60,
            ],
        ],

        'local-transcode' => [
            'supervisor-transcode' => [
                'connection' => 'redis-long',
                'queue' => ['transcode'],
                'timeout' => 3700,
                'nice' => 19,
            ],
        ],

        'local-captions' => [
            'supervisor-captions' => [
                'connection' => 'redis-long',
                'queue' => ['captions'],
                'timeout' => 1800,
                'nice' => 19,
            ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | File Watcher Configuration
    |--------------------------------------------------------------------------
    |
    | The following list of directories and files will be watched when using
    | the `horizon:listen` command. Whenever any directories or files are
    | changed, Horizon will automatically restart to apply all changes.
    |
    */

    'watch' => [
        'app',
        'bootstrap',
        'config/**/*.php',
        'database/**/*.php',
        'public/**/*.php',
        'resources/**/*.php',
        'routes',
        'composer.lock',
        'composer.json',
        '.env',
    ],
];
