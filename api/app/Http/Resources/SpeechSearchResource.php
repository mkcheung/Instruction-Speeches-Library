<?php

namespace App\Http\Resources;

use App\Models\Speech;
use Illuminate\Http\Request;

/** @mixin Speech */
class SpeechSearchResource extends SpeechResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [...parent::toArray($request), 'search_match' => $this->getAttribute('search_match')];
    }
}
