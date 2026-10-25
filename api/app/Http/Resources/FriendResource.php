<?php

namespace App\Http\Resources;

use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;
use stdClass;

class FriendResource extends JsonResource
{
    public function __construct(private readonly stdClass $row, private readonly int $mutualCount)
    {
        parent::__construct($row);
    }

    /** @return array{connection_id: int, person: array{id: int, name: string, username: string, avatar_url: ?string}, mutual_friends_count: int, requested_at: ?string, connected_at: ?string, note: ?string} */
    public function toArray(Request $request): array
    {
        return [
            'connection_id' => (int) $this->row->connection_id,
            'person' => [
                'id' => (int) $this->row->person_id,
                'name' => (string) $this->row->person_name,
                'username' => (string) $this->row->username,
                'avatar_url' => is_string($this->row->avatar_path) && $this->row->avatar_path !== ''
                    ? app(MediaUrlSigner::class)->presign($this->row->avatar_path) : null,
            ],
            'mutual_friends_count' => $this->mutualCount,
            'requested_at' => is_string($this->row->requested_at) ? Carbon::parse($this->row->requested_at)->toJSON() : null,
            'connected_at' => is_string($this->row->connected_at) ? Carbon::parse($this->row->connected_at)->toJSON() : null,
            'note' => is_string($this->row->note) ? $this->row->note : null,
        ];
    }
}
