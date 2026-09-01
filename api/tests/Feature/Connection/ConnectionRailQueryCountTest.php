<?php

use App\Models\Connection;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * STEP-13.md acceptance: "The rail's metric line is one query for the whole
 * rail — asserted by query count, not by reading the code (R19)." Builds a
 * rail with several accepted connections, each with a different review
 * history shape (both-directions / only-I-reviewed / only-they-reviewed /
 * neither), and asserts the metric aggregate itself runs as exactly ONE
 * query against `reviews` regardless of how many connections are on the
 * page — the thing a naive per-tile implementation would turn into N
 * queries.
 */
it('computes the rail metric line for every connection in one query, not per tile', function () {
    $viewer = User::factory()->create();
    $peers = User::factory()->count(4)->create();

    foreach ($peers as $peer) {
        Connection::factory()->accepted()->create(['owner_id' => $viewer->id, 'peer_id' => $peer->id]);
        Connection::factory()->accepted()->create(['owner_id' => $peer->id, 'peer_id' => $viewer->id]);
    }

    // Both directions.
    $speechA = Speech::factory()->for($peers[0])->create();
    Review::factory()->for($speechA)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $peers[0]->id, 'status' => 'published']);
    $speechB = Speech::factory()->for($viewer)->create();
    Review::factory()->for($speechB)->create(['reviewer_id' => $peers[0]->id, 'speech_owner_id' => $viewer->id, 'status' => 'published']);

    // Only I reviewed them.
    $speechC = Speech::factory()->for($peers[1])->create();
    Review::factory()->for($speechC)->create(['reviewer_id' => $viewer->id, 'speech_owner_id' => $peers[1]->id, 'status' => 'accepted']);

    // Only they reviewed me.
    $speechD = Speech::factory()->for($viewer)->create();
    Review::factory()->for($speechD)->create(['reviewer_id' => $peers[2]->id, 'speech_owner_id' => $viewer->id, 'status' => 'in_progress']);

    // peers[3]: neither.

    DB::enableQueryLog();
    $response = $this->actingAs($viewer)->getJson('/api/connections');
    $response->assertOk();
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    $metricQueries = collect($log)->filter(fn ($entry) => str_contains($entry['query'], 'group by') && str_contains($entry['query'], 'reviews'));
    expect($metricQueries)->toHaveCount(1);

    // Tighter than the `group by` substring check above: assert the TOTAL
    // count of queries touching `reviews` at all, not just ones shaped
    // like the intended aggregate. Found by the STEP-13 reconciliation
    // audit as a real gap — a naive per-tile regression using a plain
    // `Review::where(...)->count()` per peer (the most natural way to
    // accidentally reintroduce this N+1) wouldn't necessarily contain
    // "group by" and would have slipped past the check above unnoticed.
    // Exactly one `reviews`-touching query is expected for this whole
    // rail regardless of how many connections/peers are on the page.
    $reviewsQueries = collect($log)->filter(fn ($entry) => str_contains($entry['query'], 'reviews'));
    expect($reviewsQueries)->toHaveCount(1);

    $byPeer = collect($response->json('connections'))->keyBy('peer.id');
    expect($byPeer[$peers[0]->id]['metric'])->toBe('2 reviews together');
    expect($byPeer[$peers[1]->id]['metric'])->toBe('You reviewed 1');
    expect($byPeer[$peers[2]->id]['metric'])->toBe('Reviewed 1 of yours');
    expect($byPeer[$peers[3]->id]['metric'])->toContain('Connected');
});
