<?php

use App\Http\Resources\ConnectionResource;
use App\Http\Resources\PublicProfileResource;
use App\Http\Resources\ReviewerDirectoryResource;
use App\Models\Connection;
use App\Models\Profile;
use App\Models\User;
use App\Services\MediaUrlSigner;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;

it('preserves legacy optional avatar truthiness without widening identity payloads', function (?string $path, ?string $url) {
    $signer = $this->partialMock(MediaUrlSigner::class);
    if ($url === null) {
        $signer->shouldNotReceive('presign');
    } else {
        $signer->shouldReceive('presign')->times(3)->with($path)->andReturn($url);
    }
    $person = new User;
    $person->forceFill(['id' => 7, 'first_name' => 'Public', 'last_name' => 'Name', 'username' => 'public-name', 'email' => 'private@example.invalid']);
    $person->setRelation('roles', new Collection);
    $person->setRelation('profile', (new Profile)->forceFill(['avatar_path' => $path]));
    $connection = (new Connection)->forceFill(['id' => 42, 'owner_id' => 9, 'peer_id' => 7, 'state' => 'accepted']);
    $connection->setRelation('peer', $person);
    $request = Request::create('/api/u/Public-Name');

    $public = (new PublicProfileResource($person, 'Public-Name'))->resolve($request);
    $reviewer = (new ReviewerDirectoryResource($person))->resolve($request);
    $peer = (new ConnectionResource($connection))->resolve($request)['peer'];

    expect($public['avatar_url'])->toBe($url)
        ->and($public['requested_username'])->toBe('Public-Name')
        ->and($public['credential'])->toBeNull()
        ->and($reviewer['avatar_url'])->toBe($url)
        ->and($peer['avatar_url'])->toBe($url)
        ->and(array_keys($peer))->toBe(['id', 'username', 'name', 'avatar_url'])
        ->and($public)->not->toHaveKey('email')
        ->and($reviewer)->not->toHaveKey('email');
})->with([[null, null], ['', null], ['0', null], ['avatars/example.jpg', 'signed-avatar']]);
