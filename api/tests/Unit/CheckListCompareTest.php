<?php

use App\Models\Report;
use App\Support\CheckListContract;

// CheckListContract::compare() on made-up lists (PLAN-DRY-SCHEMA-STATUS-CONTRACT.md §2.1b). The
// migrated schema never shows these failures, so the Feature tests can't prove they fire.

function checkListLive(string ...$values): array
{
    return [['name' => 'ck_t_a', 'values' => $values]];
}

function checkListOwner(string ...$values): array
{
    return ['owner' => Report::class, 'label' => 'Report::STATES', 'values' => $values];
}

it('reports nothing when every list equals its owner as a set', function () {
    expect(CheckListContract::compare(['t.a' => checkListLive('y', 'x'), 't.b' => checkListLive('z')], ['t.a' => checkListOwner('x', 'y')], ['t.b' => 'no PHP list yet']))
        ->toBe([]);
});

it('reports each kind of drift', function (array $live, array $contracts, array $unowned, array $expected) {
    expect(CheckListContract::compare($live, $contracts, $unowned))->toBe($expected);
})->with([
    'a value repeated in the CHECK' => [['t.a' => checkListLive('x', 'y', 'x')], ['t.a' => checkListOwner('x', 'y')], [],
        ['t.a: CHECK differs from Report::STATES (database lacks []; database adds []; 3 values in the CHECK)']],
    'two list CHECKs on one column' => [['t.a' => [...checkListLive('x', 'y'), ...checkListLive('x')]], ['t.a' => checkListOwner('x', 'y')], [],
        ['t.a: 2 value-list CHECKs on one column; expected one']],
    'a stale UNOWNED entry' => [['t.a' => checkListLive('x')], ['t.a' => checkListOwner('x')], ['t.gone' => 'no PHP list yet'],
        ['t.gone: listed in UNOWNED but no such CHECK exists; remove the entry']],
    'a key in both maps' => [['t.a' => checkListLive('x')], ['t.a' => checkListOwner('x')], ['t.a' => 'no PHP list yet'],
        ['t.a: listed in both contracts() and UNOWNED']],
    'an owner with no values' => [['t.a' => checkListLive('x', 'y')], ['t.a' => checkListOwner()], [],
        ['t.a: CHECK differs from Report::STATES (database lacks []; database adds [x, y]; 2 values in the CHECK)']],
]);
