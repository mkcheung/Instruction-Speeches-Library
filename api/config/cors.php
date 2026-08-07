<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie', 'register', 'login', 'logout', 'forgot-password', 'reset-password', 'email/*'],

    'allowed_methods' => ['*'],

    // No wildcard: wildcards are rejected by browsers whenever
    // supports_credentials is true. The dev SPA origin is the default;
    // override via FRONTEND_URL for other environments.
    'allowed_origins' => array_filter(explode(',', env('CORS_ALLOWED_ORIGINS', env('FRONTEND_URL', 'http://localhost:5173')))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    // The SPA calls /api/health (and everything else) with credentials
    // (STEP-00-foundation.md's acceptance criterion), which requires an
    // explicit origin above, not '*'.
    'supports_credentials' => true,

];
