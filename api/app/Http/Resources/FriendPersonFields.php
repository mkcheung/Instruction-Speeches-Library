<?php

namespace App\Http\Resources;

use App\Services\MediaUrlSigner;
use stdClass;

/** Shared identity projection; discovery callers never supply a username. */
final class FriendPersonFields
{
    /** @return ($username is null ? array{id: int, name: string, avatar_url: ?string} : array{id: int, name: string, username: string, avatar_url: ?string}) */
    public static function fromRow(stdClass $row, ?string $username = null): array
    {
        $person = ['id' => (int) $row->person_id, 'name' => (string) $row->person_name];
        if ($username !== null) {
            $person['username'] = $username;
        }
        $person['avatar_url'] = app(MediaUrlSigner::class)->presignOptional(
            is_string($row->avatar_path) ? $row->avatar_path : null,
        );

        return $person;
    }
}
