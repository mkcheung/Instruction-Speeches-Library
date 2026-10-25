<?php

use App\Models\Connection;
use App\Models\User;
use Database\Seeders\RoleSeeder;

it('rejects a self-connection over HTTP without creating a connection', function () {
    $user = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);

    $this->actingAs($user)->postJson('/api/connections', ['user_id' => $user->id])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'You cannot connect with yourself.');

    expect(Connection::query()->count())->toBe(0);
});

it('walks a connection through request -> accept over HTTP', function () {
    $a = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);

    $request = $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id, 'note' => 'hi']);
    $request->assertCreated();
    expect($request->json('connection.state'))->toBe('pending');

    $bRow = Connection::query()->where('owner_id', $b->id)->where('peer_id', $a->id)->firstOrFail();

    $accept = $this->actingAs($b)->postJson("/api/connections/{$bRow->id}/accept");
    $accept->assertOk();
    expect($accept->json('connection.state'))->toBe('accepted');
});

it('rejects accepting a row that belongs to someone else', function () {
    $a = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $stranger = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);

    $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id])->assertCreated();
    $aRow = Connection::query()->where('owner_id', $a->id)->where('peer_id', $b->id)->firstOrFail();

    $this->actingAs($stranger)->postJson("/api/connections/{$aRow->id}/accept")->assertNotFound();
});

it('blocks and denies an admin from blocking on behalf of others', function () {
    $this->seed(RoleSeeder::class);
    $a = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $a->assignRole('member');
    $b = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $b->assignRole('member');
    $admin = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $admin->assignRole('admin');

    $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id])->assertCreated();
    $aRow = Connection::query()->where('owner_id', $a->id)->where('peer_id', $b->id)->firstOrFail();

    $this->actingAs($a)->postJson("/api/connections/{$aRow->id}/block")->assertOk();

    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('blocked');
});

it('enforces the per-pair rate limit on connection requests (R17)', function () {
    $a = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);

    for ($i = 0; $i < 5; $i++) {
        $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id]);
    }

    $sixth = $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id]);
    $sixth->assertStatus(429);
});

it('lists an incoming pending request via ?state=pending, giving the recipient an id to accept', function () {
    // Found missing by the STEP-13 reconciliation audit: without this,
    // nothing surfaces the id `POST /connections/{id}/accept` needs, so
    // the demo script's "Send someone a connection request. They
    // accept." had no reachable path for the recipient's half at all.
    $a = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);

    $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id, 'note' => 'hi'])->assertCreated();

    // The sender's OWN row is also 'pending' but self-initiated — it must
    // NOT appear in the sender's own pending list (nothing to act on).
    $sentList = $this->actingAs($a)->getJson('/api/connections?state=pending');
    $sentList->assertOk();
    expect($sentList->json('connections'))->toBeEmpty();

    // The recipient's row is the genuine incoming request.
    $incoming = $this->actingAs($b)->getJson('/api/connections?state=pending');
    $incoming->assertOk();
    expect($incoming->json('connections'))->toHaveCount(1);
    expect($incoming->json('connections.0.peer.id'))->toBe($a->id);
    expect($incoming->json('connections.0.metric'))->toBe('Wants to connect');

    $connectionId = $incoming->json('connections.0.id');
    $accept = $this->actingAs($b)->postJson("/api/connections/{$connectionId}/accept");
    $accept->assertOk();
    expect($accept->json('connection.state'))->toBe('accepted');

    // Accepted, so it no longer shows up as pending.
    expect($this->actingAs($b)->getJson('/api/connections?state=pending')->json('connections'))->toBeEmpty();
});

it('rejects an unrecognized state query param', function () {
    $a = User::factory()->create(['first_name' => 'Connection', 'last_name' => 'Participant', 'username' => 'connection-'.uniqid()]);

    $this->actingAs($a)->getJson('/api/connections?state=blocked')->assertStatus(422);
});

it('excludes promoted administrative peers before legacy list pagination', function (string $state) {
    $this->seed(RoleSeeder::class);
    // Legacy readers must still return unnamed, roleless non-admin peers.
    $viewer = User::factory()->create();
    $visiblePeers = User::factory()->count(21)->create();
    $promotedPeers = User::factory()->count(4)->create();

    foreach ($visiblePeers->concat($promotedPeers) as $peer) {
        $attributes = [
            'state' => $state,
            'initiated_by_id' => $peer->id,
            'requested_at' => now(),
            'connected_at' => $state === 'accepted' ? now() : null,
        ];
        Connection::factory()->create($attributes + ['owner_id' => $viewer->id, 'peer_id' => $peer->id]);
        Connection::factory()->create($attributes + ['owner_id' => $peer->id, 'peer_id' => $viewer->id]);
    }

    foreach ([['admin'], ['super_admin'], ['member', 'admin'], ['coach', 'super_admin']] as $index => $roles) {
        $promotedPeers[$index]->assignRole($roles);
    }

    $url = $state === 'accepted' ? '/api/connections' : '/api/connections?state=pending';
    $first = $this->actingAs($viewer)->getJson($url)->assertOk()
        ->assertJsonCount(20, 'connections')
        ->assertJsonStructure(['connections' => [['id', 'peer' => ['id', 'name', 'username', 'avatar_url'], 'metric']], 'meta' => ['next_cursor']]);
    expect(array_keys($first->json()))->toBe(['connections', 'meta']);
    expect(array_keys($first->json('meta')))->toBe(['next_cursor']);
    expect($first->json('meta.next_cursor'))->toBeString();
    expect($first->json('connections.0.metric'))->toBe($state === 'pending' ? 'Wants to connect' : 'Connected '.now()->format('M Y'));

    $separator = str_contains($url, '?') ? '&' : '?';
    $second = $this->getJson($url.$separator.'cursor='.urlencode($first->json('meta.next_cursor')))
        ->assertOk()->assertJsonCount(1, 'connections')->assertJsonPath('meta.next_cursor', null);

    $listedIds = collect($first->json('connections'))->concat($second->json('connections'))->pluck('peer.id')->sort()->values()->all();
    expect($listedIds)->toBe($visiblePeers->pluck('id')->sort()->values()->all());
})->with(['accepted', 'pending']);

it('denies fresh administrative actors from every legacy list despite cached roles', function (array $roles) {
    $this->seed(RoleSeeder::class);
    $viewer = User::factory()->create();
    $viewer->load('roles');
    // Promote through another model so the authenticated object's loaded
    // roles remain stale. Authorization must consult current persisted roles.
    User::query()->findOrFail($viewer->id)->assignRole($roles);

    $this->actingAs($viewer)->getJson('/api/connections')->assertForbidden();
    $this->getJson('/api/connections?state=accepted')->assertForbidden();
    $this->getJson('/api/connections?state=pending')->assertForbidden();
})->with([
    'admin' => [['admin']],
    'super admin' => [['super_admin']],
    'member and admin' => [['member', 'admin']],
    'coach and super admin' => [['coach', 'super_admin']],
]);
