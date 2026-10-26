<?php

use App\Http\Resources\FriendCandidateResource;
use App\Http\Resources\FriendResource;
use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;

it('keeps friend identity and discovery contracts distinct with stable field order', function (?string $path, ?string $url) {
    $signer = $this->partialMock(MediaUrlSigner::class);
    if ($url === null) {
        $signer->shouldNotReceive('presign');
    } else {
        $signer->shouldReceive('presign')->twice()->with($path)->andReturn($url);
    }
    $row = (object) ['person_id' => '7', 'person_name' => 'Public Name', 'username' => 'public-name',
        'avatar_path' => $path, 'connection_id' => '42', 'requested_at' => null,
        'connected_at' => '2026-01-02 00:00:00', 'note' => null,
        'email' => 'private@example.invalid', 'blocked_by_id' => 99];
    $request = Request::create('/api/friends');
    $friend = (new FriendResource($row, 3))->resolve($request);
    $candidate = (new FriendCandidateResource($row, 3))->resolve($request);

    expect($friend)->toBe([
        'connection_id' => 42,
        'person' => ['id' => 7, 'name' => 'Public Name', 'username' => 'public-name', 'avatar_url' => $url],
        'mutual_friends_count' => 3,
        'requested_at' => null,
        'connected_at' => '2026-01-02T00:00:00.000000Z',
        'note' => null,
    ])->and($candidate)->toBe([
        'person' => ['id' => 7, 'name' => 'Public Name', 'avatar_url' => $url],
        'mutual_friends_count' => 3,
    ]);
})->with([[null, null], ['', null], ['0', 'signed-zero'], ['avatars/example.jpg', 'signed-avatar']]);
