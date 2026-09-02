<?php

use App\Models\Speech;
use App\Models\User;

/**
 * MODERNIZATION_PLAN §6.7.1 / STEP-13-FROZEN-CONTRACT.md §10 — the single
 * highest-priority correctness item in this step. `connections` is a
 * routing table, not an ACL: it must never appear in a WHERE clause that
 * returns speech or annotation content. This test freezes
 * `Speech::scopeVisibleTo`'s generated SQL byte-for-byte, BEFORE and AFTER
 * every other piece of STEP-13's work, so any future edit that widens this
 * scope (deliberately or by a "just add an OR connections..." shortcut)
 * fails loudly here instead of shipping.
 *
 * Written and run green FIRST, before any other STEP-13 code was touched,
 * then re-run unchanged after the rest of the step landed, per the frozen
 * contract's own instruction. `Speech::scopeVisibleTo` itself was not
 * touched by this step — see git history / the method's own docblock.
 */
it('does not widen speech visibility — scopeVisibleTo SQL is byte-identical to the frozen snapshot', function () {
    $user = User::factory()->create();

    $sql = Speech::query()->visibleTo($user)->toRawSql();

    expect($sql)->toBe(file_get_contents(__DIR__.'/__snapshots__/visible_to.sql'));
});
