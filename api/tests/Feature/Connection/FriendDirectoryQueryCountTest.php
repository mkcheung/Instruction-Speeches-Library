<?php

use App\Models\Connection;
use App\Models\User;
use App\Services\FriendDirectoryService;
use Illuminate\Support\Facades\DB;

function queryDirectoryPerson(): User
{
    return User::factory()->create(['first_name' => 'Queryable', 'last_name' => 'Person', 'username' => 'query-'.uniqid()]);
}

function queryDirectoryPair(User $a, User $b): void
{
    foreach ([[$a, $b], [$b, $a]] as [$owner, $peer]) {
        Connection::factory()->accepted()->create(['owner_id' => $owner->id, 'peer_id' => $peer->id, 'initiated_by_id' => $a->id]);
    }
}

function captureDirectoryQueries(Closure $operation): array
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    try {
        $operation();

        return DB::getQueryLog();
    } finally {
        DB::disableQueryLog();
    }
}

it('does no people scan or mutual aggregate for a blank find', function () {
    $viewer = queryDirectoryPerson();
    queryDirectoryPerson();
    $queries = captureDirectoryQueries(function () use ($viewer) {
        expect(app(FriendDirectoryService::class)->find($viewer, '', null)['rows'])->toBeEmpty();
    });
    // One fresh actor eligibility EXISTS is required; no candidate SELECT or COUNT.
    expect($queries)->toHaveCount(1);
    expect(strtolower($queries[0]['query']))->toStartWith('select exists');
});

it('keeps queries bounded from one to twenty candidates with one grouped mutual aggregate', function (string $view) {
    $viewer = queryDirectoryPerson();
    $shared = User::factory()->create(['first_name' => 'Shared', 'username' => 'shared-'.uniqid()]);
    queryDirectoryPair($viewer, $shared);
    $first = queryDirectoryPerson();
    queryDirectoryPair($first, $shared);
    if ($view === 'accepted') {
        queryDirectoryPair($viewer, $first);
    }
    $fetch = fn () => $view === 'find'
        ? app(FriendDirectoryService::class)->find($viewer, 'Queryable', null)
        : app(FriendDirectoryService::class)->friends($viewer, 'accepted', 'Queryable', null);
    $one = captureDirectoryQueries($fetch);
    for ($i = 1; $i < 20; $i++) {
        $candidate = queryDirectoryPerson();
        queryDirectoryPair($candidate, $shared);
        if ($view === 'accepted') {
            queryDirectoryPair($viewer, $candidate);
        }
    }
    $twenty = captureDirectoryQueries($fetch);
    $page = $fetch();
    expect($page['rows'])->toHaveCount(20);
    expect(array_values($page['mutual']))->toBe(array_fill(0, 20, 1));
    expect(count($twenty))->toBe(count($one))->toBe($view === 'accepted' ? 4 : 3);
    foreach ([$one, $twenty] as $queries) {
        $aggregates = array_filter($queries, fn (array $query) => str_contains(strtolower($query['query']), 'count(distinct'));
        expect($aggregates)->toHaveCount(1);
        expect(strtolower(array_values($aggregates)[0]['query']))->toContain('group by');
        if ($view === 'find') {
            expect(array_filter($queries, fn (array $query) => str_contains(strtolower($query['query']), 'count(*)')))->toBeEmpty();
        }
    }
})->with(['find', 'accepted']);
