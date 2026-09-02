<?php

namespace App\Http\Resources;

use App\Models\User;
use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The public `/u/{username}` payload. Identity only, per S1's deliberate
 * stub (no timeline, no connections rail) — everything here is either
 * already public-by-definition (name, username) or explicitly opted into
 * public display (bio, avatar).
 *
 * @mixin User
 */
class PublicProfileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $profile = $this->profile;

        return [
            // STEP-13: `POST /api/connections` needs a numeric target id,
            // and this is the only endpoint that resolves a username to
            // one for a viewer who hasn't connected yet — confirmed by
            // the STEP-13 reconciliation audit that the frontend's
            // "Connect" button was unreachable without it. Exposing a
            // bigint PK is fine here specifically: it identifies no more
            // than the already-public `username` already does, and every
            // other public-identity field on this resource is likewise
            // "public by definition" per this class's own docblock.
            'id' => $this->id,
            'username' => $this->username,
            'display_name' => $profile?->display_name ?: trim("{$this->first_name} {$this->last_name}"),
            'pronouns' => $profile?->pronouns,
            'bio' => $profile?->bio,
            'location' => $profile?->location,
            // `/api/u/{username}` is UNAUTHENTICATED (this class's own
            // docblock: "identity only... public-by-definition"). Using
            // `getRoleNames()->first()` verbatim — `ReviewerDirectoryResource`'s
            // convention for the same field — would leak `admin`/
            // `super_admin` to any anonymous caller, letting someone
            // enumerate usernames to identify real site administrators
            // for targeted phishing. Found by `/code-review`'s
            // removed-behavior-auditor angle against this exact line.
            // Only the one role this badge is actually for is ever sent.
            'credential' => $this->hasRole('coach') ? 'coach' : null,
            'avatar_url' => $profile?->avatar_path
                ? app(MediaUrlSigner::class)->presign($profile->avatar_path)
                : null,
        ];
    }
}
