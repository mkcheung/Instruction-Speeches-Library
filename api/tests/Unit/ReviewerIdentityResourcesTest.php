<?php

use App\Http\Resources\ReviewResource;
use App\Http\Resources\ReviewRosterResource;
use App\Models\Review;
use App\Models\User;
use Illuminate\Http\Request;

it('preserves loaded live erased and omitted reviewer identity in both envelopes', function (string $resourceClass, string $shape) {
    $review = new Review;
    $review->preventsLazyLoading = true;
    $live = (new User)->forceFill(['id' => 7, 'username' => 'reviewer', 'first_name' => 'Ada', 'last_name' => 'Lovelace']);
    if ($shape !== 'unloaded') {
        $review->setRelation('reviewer', match ($shape) {
            'null' => null,
            'anonymized' => $live->forceFill(['anonymized_at' => now()]),
            default => $live,
        });
    }

    $payload = (new $resourceClass($review))->resolve(Request::create('/'));

    if ($shape === 'unloaded') {
        expect($payload)->not->toHaveKey('reviewer');
    } else {
        expect($payload['reviewer'])->toBe($shape === 'live'
            ? ['id' => 7, 'username' => 'reviewer', 'name' => 'Ada Lovelace']
            : ['display_name' => 'Former reviewer']);
    }
})->with(['review' => [ReviewResource::class], 'roster' => [ReviewRosterResource::class]])
    ->with(['unloaded', 'null', 'anonymized', 'live']);
