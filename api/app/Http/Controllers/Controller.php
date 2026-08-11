<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;

abstract class Controller
{
    // STEP-05: first Policy-backed controllers in this codebase (see
    // App\Policies\ReviewPolicy/SpeechPolicy) — pulled onto the base
    // controller rather than per-controller so `$this->authorize()` works
    // uniformly everywhere from here on.
    use AuthorizesRequests;
}
