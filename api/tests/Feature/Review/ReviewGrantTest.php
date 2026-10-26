<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Support\ReviewGrant;
use Illuminate\Support\Facades\DB;

it('agrees across loaded reviews model scopes relations and qualified SQL grants', function (string $status, bool $revoked) {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $review = Review::factory()->create(['speech_id' => $speech->id, 'speech_owner_id' => $owner->id,
        'reviewer_id' => $reviewer->id, 'status' => $status, 'revoked_at' => $revoked ? now() : null]);
    $expected = ! $revoked && in_array($status, ['accepted', 'in_progress', 'published'], true);
    $query = DB::table('reviews')->where('reviews.id', $review->id);
    ReviewGrant::constrain($query, 'reviews.');

    expect(ReviewGrant::allows($review))->toBe($expected)
        ->and(Review::query()->granting()->whereKey($review->id)->exists())->toBe($expected)
        ->and($speech->reviews()->granting()->whereKey($review->id)->exists())->toBe($expected)
        ->and($query->exists())->toBe($expected)
        ->and(Speech::query()->visibleTo($reviewer)->whereKey($speech->id)->exists())->toBe($expected);
})->with(['invited', 'declined', 'accepted', 'in_progress', 'published', 'abandoned'])->with([false, true]);
