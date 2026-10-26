<?php

use App\Models\Connection;
use App\Models\Profile;
use App\Models\User;
use App\Services\ConnectionService;
use App\Services\MediaUrlSigner;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpKernel\Exception\HttpException;

function directoryPerson(array $attributes = [], ?string $role = null): User
{
    $user = User::factory()->create(array_replace(['first_name' => 'Directory', 'last_name' => 'Person', 'username' => 'directory-'.uniqid()], $attributes));
    if ($role !== null) {
        $user->assignRole($role);
    }

    return $user;
}

/** Deliberately supports invalid historical pairs; mutations use the real service below. */
function directoryPair(User $owner, User $peer, string $state = 'accepted', array $mine = [], array $mirror = []): array
{
    $values = ['blocked_by_id' => $state === 'blocked' ? $peer->id : null, 'state' => $state, 'initiated_by_id' => $peer->id, 'requested_at' => '2026-01-02 03:04:05',
        'connected_at' => $state === 'accepted' ? '2026-01-03 04:05:06' : null];

    foreach (['mine', 'mirror'] as $side) {
        if ((${$side}['state'] ?? null) === 'blocked') {
            ${$side}['blocked_by_id'] = $peer->id;
        }
    }

    return [Connection::factory()->create(array_replace($values, ['owner_id' => $owner->id, 'peer_id' => $peer->id], $mine)),
        Connection::factory()->create(array_replace($values, ['owner_id' => $peer->id, 'peer_id' => $owner->id], $mirror))];
}

beforeEach(function () {
    $this->seed(RoleSeeder::class);
});

it('requires authentication for every directory endpoint', function () {
    $target = directoryPerson();
    foreach (['/api/friends', '/api/friends/find?search=Directory', '/api/friends/relationship/'.$target->id] as $url) {
        $this->getJson($url)->assertUnauthorized();
    }
});

it('allows named roleless members and coaches including a voice-erasure stamp', function (?string $role) {
    $viewer = directoryPerson([], $role);
    $target = directoryPerson(['erasure_started_at' => now()], $role);
    $this->actingAs($viewer)->getJson('/api/friends/find?search=Directory')->assertOk()->assertJsonPath('people.0.person.id', $target->id);
    $this->postJson('/api/connections', ['user_id' => $target->id])->assertCreated();
    $row = Connection::where('owner_id', $target->id)->firstOrFail();
    $this->actingAs($target)->postJson('/api/connections/'.$row->id.'/accept')->assertOk();
})->with([null, 'member', 'coach']);

it('excludes every admin tier target including mixed roles from discovery lists mutuals and writes', function (string $role) {
    $viewer = directoryPerson();
    $candidate = directoryPerson();
    $target = directoryPerson([], $role);
    $target->assignRole('member');
    directoryPair($viewer, $target);
    directoryPair($candidate, $target);
    $this->actingAs($viewer)->getJson('/api/friends')->assertOk()->assertJsonPath('meta.total', 0);
    $this->getJson('/api/friends/find?search=Directory')->assertOk()->assertJsonCount(1, 'people')->assertJsonPath('people.0.mutual_friends_count', 0);
    $this->getJson('/api/friends/relationship/'.$target->id)->assertJsonPath('relationship.state', 'unavailable');
    $this->postJson('/api/connections', ['user_id' => $target->id])->assertNotFound();
    [$row] = directoryPair($viewer, directoryPerson([], $role), 'pending');
    $this->postJson('/api/connections/'.$row->id.'/accept')->assertNotFound();
})->with(['admin', 'super_admin']);

it('denies admin tier actors even with member role across reads send and accept', function (string $role) {
    $actor = directoryPerson([], $role);
    $actor->assignRole('member');
    $target = directoryPerson();
    [$row] = directoryPair($actor, $target, 'pending');
    $this->actingAs($actor);
    foreach (['/api/friends', '/api/friends?view=incoming', '/api/friends/find?search=Directory', '/api/friends/relationship/'.$target->id] as $url) {
        $this->getJson($url)->assertForbidden();
    }
    $this->postJson('/api/connections', ['user_id' => $target->id])->assertForbidden();
    $this->postJson('/api/connections/'.$row->id.'/accept')->assertForbidden();
    expect(fn () => app(ConnectionService::class)->request($actor, $target, null))->toThrow(HttpException::class);
})->with(['admin', 'super_admin']);

it('filters unusable and inactive identities and rereads eligibility for stale writes', function (array $invalid) {
    $viewer = directoryPerson();
    $target = directoryPerson();
    [$row] = directoryPair($viewer, $target, 'pending');
    // Keep the previously loaded model stale to exercise the service boundary.
    DB::table('users')->where('id', $target->id)->update($invalid);
    $this->actingAs($viewer)->getJson('/api/friends?view=incoming')->assertJsonPath('meta.total', 0);
    $this->getJson('/api/friends/find?search=Directory')->assertJsonCount(0, 'people');
    $this->getJson('/api/friends/relationship/'.$target->id)->assertJsonPath('relationship.state', 'unavailable');
    expect(fn () => app(ConnectionService::class)->request($viewer, $target, null))->toThrow(HttpException::class);
    $this->postJson('/api/connections/'.$row->id.'/accept')->assertNotFound();
    DB::table('users')->where('id', $viewer->id)->update(isset($invalid['username']) ? ['username' => null] : $invalid);
    foreach (['/api/friends', '/api/friends?view=incoming', '/api/friends/find?search=Directory', '/api/friends/relationship/'.$target->id] as $url) {
        $this->getJson($url)->assertForbidden();
    }
    $this->postJson('/api/connections', ['user_id' => $target->id])->assertForbidden();
    $this->postJson('/api/connections/'.$row->id.'/accept')->assertForbidden();
})->with([
    [['username' => '   ']], [['username' => null]], [['first_name' => null, 'last_name' => '  ']],
    [['suspended_at' => '2026-01-01 00:00:00']], [['anonymized_at' => '2026-01-01 00:00:00']], [['deleted_at' => '2026-01-01 00:00:00']],
]);

it('keeps self request precedence and ownership checks while allowing cleanup of promoted peers', function () {
    $actor = directoryPerson();
    $peer = directoryPerson();
    [$mine, $theirs] = directoryPair($actor, $peer, 'pending');
    $peer->assignRole('admin');
    $this->actingAs($actor)->postJson('/api/connections/'.$mine->id.'/accept')->assertNotFound();
    $this->postJson('/api/connections/'.$theirs->id.'/accept')->assertNotFound();
    $this->postJson('/api/connections/'.$mine->id.'/decline')->assertOk();
    $this->postJson('/api/connections/'.$mine->id.'/block')->assertOk();
    $actor->assignRole('admin');
    $this->postJson('/api/connections', ['user_id' => $actor->id])->assertUnprocessable();
});

it('allows profile-only identities and cleanup after a peer becomes inactive', function () {
    $actor = directoryPerson(['first_name' => null, 'last_name' => null]);
    Profile::updateOrCreate(['user_id' => $actor->id], ['display_name' => 'Profile Identity']);
    $peer = directoryPerson();
    [$mine] = directoryPair($actor, $peer);
    DB::table('users')->where('id', $peer->id)->update(['suspended_at' => now()]);
    $this->actingAs($actor)->getJson('/api/friends')->assertOk()->assertJsonCount(0, 'friends');
    $this->postJson('/api/connections/'.$mine->id.'/decline')->assertOk();
    $this->postJson('/api/connections/'.$mine->id.'/block')->assertOk();
    expect($mine->fresh()->state)->toBe('blocked');
});

it('rejects a missing mirror without recreating or changing either existing row', function () {
    $actor = directoryPerson();
    $peer = directoryPerson();
    [$mine, $mirror] = directoryPair($actor, $peer, 'pending');
    $mirror->delete();
    $before = $mine->fresh()->getAttributes();
    $this->actingAs($actor)->getJson('/api/friends?view=incoming')->assertJsonCount(0, 'friends');
    $this->getJson('/api/friends/find?search=Directory')->assertJsonCount(0, 'people');
    $this->getJson('/api/friends/relationship/'.$peer->id)->assertJsonPath('relationship.state', 'unavailable');
    $this->postJson('/api/connections', ['user_id' => $peer->id])->assertConflict();
    $this->postJson('/api/connections/'.$mine->id.'/accept')->assertConflict();
    $this->postJson('/api/connections/'.$mine->id.'/decline')->assertConflict();
    expect($mine->fresh()->getAttributes())->toBe($before);
    expect(Connection::count())->toBe(1);
});

it('returns the true total and stable tied-date pages with search across the full accepted list', function () {
    $viewer = directoryPerson();
    $ids = [];
    for ($i = 0; $i < 25; $i++) {
        $peer = directoryPerson(['first_name' => 'Duplicate', 'last_name' => $i === 0 ? 'Needle' : 'Name']);
        [$row] = directoryPair($viewer, $peer);
        $ids[] = $row->id;
    }
    $this->actingAs($viewer);
    $first = $this->getJson('/api/friends')->assertOk()->assertJsonCount(20, 'friends')->assertJsonPath('meta.total', 25);
    $second = $this->getJson('/api/friends?'.http_build_query(['cursor' => $first->json('meta.next_cursor')]))->assertOk()->assertJsonCount(5, 'friends')->assertJsonPath('meta.total', 25)->assertJsonPath('meta.next_cursor', null);
    expect(array_merge(array_column($first->json('friends'), 'connection_id'), array_column($second->json('friends'), 'connection_id')))->toBe(array_reverse($ids));
    $this->getJson('/api/friends?search=duplicate%20needle')->assertJsonCount(1, 'friends')->assertJsonPath('meta.total', 1);
});

it('paginates incoming requests by viewer-owned id and excludes outgoing and timestamp-less rows', function () {
    $viewer = directoryPerson();
    $ids = [];
    for ($i = 0; $i < 22; $i++) {
        [$mine] = directoryPair($viewer, directoryPerson(), 'pending');
        $ids[] = $mine->id;
    }
    directoryPair($viewer, directoryPerson(), 'pending', ['initiated_by_id' => $viewer->id], ['initiated_by_id' => $viewer->id]);
    directoryPair($viewer, directoryPerson(), 'pending', ['requested_at' => null]);
    Log::spy();
    $first = $this->actingAs($viewer)->getJson('/api/friends?view=incoming')->assertOk()->assertJsonPath('meta.total', 22)->assertJsonCount(20, 'friends');
    $second = $this->getJson('/api/friends?'.http_build_query(['view' => 'incoming', 'cursor' => $first->json('meta.next_cursor')]))->assertOk()->assertJsonCount(2, 'friends')->assertJsonPath('meta.total', 22);
    expect(array_merge(array_column($first->json('friends'), 'connection_id'), array_column($second->json('friends'), 'connection_id')))->toBe(array_reverse($ids));
    Log::shouldNotHaveReceived('warning');
});

it('binds opaque cursors to viewer view normalized search and valid scalar positions', function () {
    $viewer = directoryPerson();
    $this->actingAs($viewer);
    $valid = ['v' => 1, 'viewer' => $viewer->id, 'view' => 'accepted', 'search' => '', 'id' => 1, 'at' => '2026-01-02 03:04:05'];
    foreach ([['v' => 2], ['viewer' => $viewer->id + 1], ['view' => 'incoming'], ['search' => 'changed'], ['id' => '1'], ['id' => 0], ['at' => '2026-02-30 00:00:00'], ['at' => []], ['at' => '2026-01-01T00:00:00Z']] as $change) {
        $cursor = base64_encode(json_encode(array_replace($valid, $change)));
        $this->getJson('/api/friends?'.http_build_query(['cursor' => $cursor]))->assertUnprocessable();
    }
    $this->getJson('/api/friends?cursor=not-base64')->assertUnprocessable();
    $find = array_replace($valid, ['view' => 'find', 'search' => 'Directory', 'at' => null]);
    $this->getJson('/api/friends/find?'.http_build_query(['search' => ' Directory ', 'cursor' => base64_encode(json_encode($find))]))->assertOk();
    $find['at'] = '2026-01-02 03:04:05';
    $this->getJson('/api/friends/find?'.http_build_query(['search' => 'Directory', 'cursor' => base64_encode(json_encode($find))]))->assertUnprocessable();
});

it('rejects nonscalar oversized and unsupported query parameters', function (string $query) {
    $this->actingAs(directoryPerson())->getJson('/api/friends?'.$query)->assertUnprocessable();
    if (! str_starts_with($query, 'view')) {
        $this->getJson('/api/friends/find?'.$query)->assertUnprocessable();
    }
})->with(['view=blocked', 'view[]=accepted', 'search[]=x', 'cursor[]=x', 'search='.str_repeat('a', 101), 'cursor='.str_repeat('a', 2049)]);

it('treats wildcard and escape characters as literal substrings and searches displayed full names', function (string $name, string $query) {
    $viewer = directoryPerson();
    $peer = directoryPerson(['first_name' => $name, 'last_name' => '']);
    directoryPerson(['first_name' => 'Decoy Plain Name']);
    $response = $this->actingAs($viewer)->getJson('/api/friends/find?'.http_build_query(['search' => $query]))->assertOk()->assertJsonCount(1, 'people');
    expect($response->json('people.0.person.name'))->toBe(trim($name));
    expect($response->json('people.0.person.id'))->toBe($peer->id);
})->with([['Percent%Person', '%'], ['Under_score', '_'], ['Bang!Person', '!'], ['Back\\slash', '\\'], ['Alice McExample', ' aLiCe mCeXaMpLe ']]);

it('uses trimmed display names and blank or null display-name fallback without leaking contact fields', function () {
    $viewer = directoryPerson();
    $display = directoryPerson(['first_name' => 'Hidden', 'last_name' => 'Legalname']);
    Profile::updateOrCreate(['user_id' => $display->id], ['display_name' => '  Stage Person  ', 'avatar_path' => 'avatars/test.jpg']);
    $fallback = directoryPerson(['first_name' => 'Fallback', 'last_name' => 'Fullname']);
    Profile::updateOrCreate(['user_id' => $fallback->id], ['display_name' => '   ']);
    $null = directoryPerson(['first_name' => 'Fallback', 'last_name' => 'Null']);
    Profile::updateOrCreate(['user_id' => $null->id], ['display_name' => null]);
    $this->partialMock(MediaUrlSigner::class)->shouldReceive('presign')->with('avatars/test.jpg')->andReturn('https://signed.example/avatar');
    $this->actingAs($viewer)->getJson('/api/friends/find?search=legalname')->assertJsonCount(0, 'people');
    $find = $this->getJson('/api/friends/find?search=stage')->assertJsonPath('people.0.person.name', 'Stage Person')->assertJsonPath('people.0.person.avatar_url', 'https://signed.example/avatar');
    expect(array_keys($find->json('people.0.person')))->toBe(['id', 'name', 'avatar_url']);
    $this->getJson('/api/friends/find?search=fallback')->assertJsonCount(2, 'people');
    directoryPair($viewer, $display, 'pending', ['note' => 'Hello from the stage']);
    $list = $this->getJson('/api/friends?view=incoming')->assertJsonPath('friends.0.note', 'Hello from the stage')->assertJsonPath('friends.0.person.username', $display->username);
    expect($list->getContent())->not->toContain($display->email);
});

it('only discovers wholly absent and valid declined pairs with stable user-id continuation', function () {
    $viewer = directoryPerson();
    $expected = [];
    for ($i = 0; $i < 23; $i++) {
        $peer = directoryPerson();
        if ($i % 2 === 0) {
            directoryPair($viewer, $peer, 'declined', ['initiated_by_id' => null], ['initiated_by_id' => null]);
        }
        $expected[] = $peer->id;
    }
    foreach (['accepted', 'pending', 'blocked'] as $state) {
        directoryPair($viewer, directoryPerson(), $state);
    }
    $asymmetric = directoryPerson();
    Connection::factory()->create(['owner_id' => $asymmetric->id, 'peer_id' => $viewer->id, 'state' => 'declined']);
    directoryPair($viewer, directoryPerson(), 'declined', [], ['initiated_by_id' => $viewer->id]);
    $first = $this->actingAs($viewer)->getJson('/api/friends/find?search=Directory')->assertOk()->assertJsonCount(20, 'people');
    $second = $this->getJson('/api/friends/find?'.http_build_query(['search' => 'Directory', 'cursor' => $first->json('meta.next_cursor')]))->assertOk()->assertJsonCount(3, 'people')->assertJsonPath('meta.next_cursor', null);
    expect(array_merge(array_column(array_column($first->json('people'), 'person'), 'id'), array_column(array_column($second->json('people'), 'person'), 'id')))->toBe($expected);
    expect($first->json('meta'))->not->toHaveKey('total');
});

it('fails closed on corrupt mirrors across lists discovery projection and mutation without repairing them', function (string $state, array $mineChange, array $mirrorChange, bool $reverse) {
    $first = directoryPerson();
    $second = directoryPerson();
    [$viewer, $peer] = $reverse ? [$second, $first] : [$first, $second];
    [$mine, $mirror] = directoryPair($viewer, $peer, $state, $mineChange, $mirrorChange);
    $before = DB::table('connections')->orderBy('id')->get()->toJson();
    $this->actingAs($viewer)->getJson('/api/friends?view='.($state === 'pending' ? 'incoming' : 'accepted'))->assertJsonCount(0, 'friends');
    $this->getJson('/api/friends/find?search=Directory')->assertJsonCount(0, 'people');
    $this->getJson('/api/friends/relationship/'.$peer->id)->assertJsonPath('relationship.state', 'unavailable');
    $this->postJson('/api/connections', ['user_id' => $peer->id])->assertConflict();
    $this->postJson('/api/connections/'.$mine->id.'/accept')->assertConflict();
    $this->postJson('/api/connections/'.$mine->id.'/decline')->assertConflict();
    expect(DB::table('connections')->orderBy('id')->get()->toJson())->toBe($before);
})->with([
    ['accepted', [], ['state' => 'blocked']], ['accepted', ['state' => 'blocked'], []],
    ['pending', [], ['state' => 'blocked']], ['pending', ['state' => 'blocked'], []],
    ['pending', [], ['initiated_by_id' => null]], ['accepted', ['initiated_by_id' => null], []],
])->with([false, true]);

it('requires all four accepted edges and an eligible shared person for mutual counts', function (string $corruption) {
    $viewer = directoryPerson();
    $candidate = directoryPerson();
    $shared = directoryPerson();
    $good = directoryPerson();
    directoryPair($viewer, $good);
    directoryPair($candidate, $good);
    $edges = array_merge(directoryPair($viewer, $shared), directoryPair($candidate, $shared));
    if (is_numeric($corruption)) {
        $edges[(int) $corruption]->update(['state' => 'pending']);
    } elseif ($corruption === 'admin') {
        $shared->assignRole('admin');
    } elseif ($corruption === 'inactive') {
        DB::table('users')->where('id', $shared->id)->update(['suspended_at' => now()]);
    } else {
        $edges[3]->delete();
    }
    $this->actingAs($viewer)->getJson('/api/friends/find?search=Directory')->assertJsonPath('people.0.person.id', $candidate->id)->assertJsonPath('people.0.mutual_friends_count', 1);
    directoryPair($viewer, $candidate);
    $this->getJson('/api/friends')->assertJsonPath('friends.0.person.id', $candidate->id)->assertJsonPath('friends.0.mutual_friends_count', 1);
})->with(['0', '1', '2', '3', 'admin', 'inactive', 'missing']);

it('projects none declined pending directions accepted date and viewer-owned ids beyond page one', function () {
    $viewer = directoryPerson();
    $target = directoryPerson();
    $this->actingAs($viewer)->getJson('/api/friends/relationship/'.$target->id)->assertExactJson(['relationship' => ['state' => 'none', 'direction' => null, 'connection_id' => null, 'connected_at' => null]]);
    [$mine, $mirror] = directoryPair($viewer, $target, 'declined');
    $this->getJson('/api/friends/relationship/'.$target->id)->assertJsonPath('relationship.state', 'none')->assertJsonPath('relationship.connection_id', null);
    $mine->update(['state' => 'pending']);
    $mirror->update(['state' => 'pending']);
    $this->getJson('/api/friends/relationship/'.$target->id)->assertJsonPath('relationship.direction', 'incoming')->assertJsonPath('relationship.connection_id', $mine->id);
    $mine->update(['initiated_by_id' => $viewer->id]);
    $mirror->update(['initiated_by_id' => $viewer->id]);
    $this->getJson('/api/friends/relationship/'.$target->id)->assertJsonPath('relationship.direction', 'outgoing');
    app(ConnectionService::class)->accept($target, $mirror->id);
    for ($i = 0; $i < 21; $i++) {
        directoryPair($viewer, directoryPerson(), 'accepted', ['connected_at' => now()->addDay()]);
    }
    $this->getJson('/api/friends/relationship/'.$target->id)->assertJsonPath('relationship.state', 'accepted')->assertJsonPath('relationship.connection_id', $mine->id)->assertJsonPath('relationship.connected_at', $mine->fresh()->connected_at->toJSON());
    $this->getJson('/api/friends/relationship/'.$viewer->id)->assertJsonPath('relationship.state', 'unavailable');
});

it('shares the bounded read limiter across friends discovery and relationship', function () {
    $viewer = directoryPerson();
    $target = directoryPerson();
    $this->actingAs($viewer);
    for ($i = 0; $i < 120; $i++) {
        $this->getJson(['/api/friends', '/api/friends/find', '/api/friends/relationship/'.$target->id][$i % 3])->assertOk();
    }
    $this->getJson('/api/friends/find')->assertTooManyRequests();
    $this->actingAs($target)->getJson('/api/friends')->assertOk();
});

it('rejects a search that is not valid UTF-8 with 422 instead of reaching the query', function () {
    $viewer = directoryPerson();

    foreach (['/api/friends/find?search=%FF', '/api/friends?search=%FF', '/api/friends?view=incoming&search=ab%C3'] as $url) {
        $this->actingAs($viewer)->getJson($url)->assertUnprocessable()->assertJsonValidationErrors('search');
    }
});
