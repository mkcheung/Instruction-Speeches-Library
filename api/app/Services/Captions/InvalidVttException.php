<?php

namespace App\Services\Captions;

use RuntimeException;

/**
 * Thrown by Vtt::parse() on malformed WebVTT. STEP-09-captions.md's
 * caption-edit endpoint (App\Http\Requests\Caption\UpdateCaptionsRequest)
 * catches this to turn it into the frozen contract's "422 on invalid VTT"
 * — never a 500, and never a silently-accepted broken file.
 */
class InvalidVttException extends RuntimeException {}
