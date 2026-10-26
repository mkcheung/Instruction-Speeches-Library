<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use stdClass;

class FriendCandidateResource extends JsonResource
{
    public function __construct(private readonly stdClass $row, private readonly int $mutualCount)
    {
        parent::__construct($row);
    }

    /** @return array{person: array{id: int, name: string, avatar_url: ?string}, mutual_friends_count: int} */
    public function toArray(Request $request): array
    {
        return [
            'person' => FriendPersonFields::fromRow($this->row),
            'mutual_friends_count' => $this->mutualCount,
        ];
    }
}
