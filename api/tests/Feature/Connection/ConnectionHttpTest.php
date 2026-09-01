<?php

use App\Models\Connection;
use App\Models\User;
use Database\Seeders\RoleSeeder;

it('walks a connection through request -> accept over HTTP', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();

    $request = $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id, 'note' => 'hi']);
    $request->assertCreated();
    expect($request->json('connection.state'))->toBe('pending');

    $bRow = Connection::query()->where('owner_id', $b->id)->where('peer_id', $a->id)->firstOrFail();

    $accept = $this->actingAs($b)->postJson("/api/connections/{$bRow->id}/accept");
    $accept->assertOk();
    expect($accept->json('connection.state'))->toBe('accepted');
});

it('rejects accepting a row that belongs to someone else', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $stranger = User::factory()->create();

    $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id])->assertCreated();
    $aRow = Connection::query()->where('owner_id', $a->id)->where('peer_id', $b->id)->firstOrFail();

    $this->actingAs($stranger)->postJson("/api/connections/{$aRow->id}/accept")->assertNotFound();
});

it('blocks and denies an admin from blocking on behalf of others', function () {
    $this->seed(RoleSeeder::class);
    $a = User::factory()->create();
    $a->assignRole('member');
    $b = User::factory()->create();
    $b->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $this->actingAs($a)->postJson('/api/connections', ['user_id' => $b->id])->assertCreated();
    $aRow = Connection::query()->where('owner_id', $a->id)->where('peer_id', $b->id)->firstOrFail();

    $this->actingAs($a)->postJson("/api/connections/{$aRow->id}/block")->assertOk();

    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('blocked');
});

it('enforces the per-pair rate limit on connection requests (R17)', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();

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
    $a = User::factory()->create();
    $b = User::factory()->create();

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
    $a = User::factory()->create();

    $this->actingAs($a)->getJson('/api/connections?state=blocked')->assertStatus(422);
});
