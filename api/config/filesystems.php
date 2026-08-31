<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        // The one disk all user media goes through (§10.5, §9.4): an
        // S3-compatible bucket backed by SeaweedFS in dev/CI and swappable
        // for real S3/R2/B2 later purely by env (no code change — the seam
        // is "config", per §9.4's table). Never read/written directly:
        // everything goes through App\Services\MediaUrlSigner.
        'media' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
            'throw' => false,
            'report' => false,
        ],

        // Identical to `media` except for `endpoint`. SigV4 presigning signs
        // the `host` the request is built against (§9.3), so a URL signed
        // with the container-internal `seaweedfs:8333` endpoint is correct
        // for `app` to call but unreachable from a browser on the host —
        // there is no such DNS name outside the compose network. This disk
        // exists ONLY so MediaUrlSigner can sign against the
        // browser-reachable endpoint; every other operation (put/exists/
        // delete from within the container) still goes through `media`.
        'media_public' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT_PUBLIC', env('AWS_ENDPOINT')),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
            'throw' => false,
            'report' => false,
        ],

        // STEP-12-FROZEN-CONTRACT.md §5: certification PDFs live on their
        // OWN disk, never `media`/`media_public` — both of those are
        // S3-compatible buckets on the same browser-reachable origin
        // family the admin panel could run behind, and this step's whole
        // point is that a certification PDF must NEVER be servable that
        // way. Local (private) storage inside the `app`/`queue-worker`
        // containers: nothing here is ever exposed via `Storage::url()`
        // or a bucket-level presigned GET — the ONLY way out is
        // App\Services\ApplicationDocumentUrlSigner's signed Laravel
        // route, which forces `Content-Disposition: attachment` and
        // `X-Content-Type-Options: nosniff` on every response (the first
        // place in this codebase setting either header — see that
        // controller).
        'application_documents' => [
            'driver' => 'local',
            'root' => storage_path('app/application_documents'),
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
