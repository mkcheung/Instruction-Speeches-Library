<?php

namespace App\Http\Resources;

use App\Services\MediaUrlSigner;
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
            'person' => [
                'id' => (int) $this->row->person_id,
                'name' => (string) $this->row->person_name,
                'avatar_url' => is_string($this->row->avatar_path) && $this->row->avatar_path !== ''
                    ? app(MediaUrlSigner::class)->presign($this->row->avatar_path) : null,
            ],
            'mutual_friends_count' => $this->mutualCount,
        ];
    }
}
