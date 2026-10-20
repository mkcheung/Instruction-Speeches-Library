<?php

use App\Models\Annotation;
use App\Models\Review;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

it('inventories ambiguous history without exposing or rewriting feedback', function () {
    $review = Review::factory()->create();
    $known = Annotation::factory()->for($review)->create(['timing_type' => 'point', 'body' => 'Private transcript']);
    $unknown = Annotation::factory()->for($review)->create(['timing_type' => null, 'body' => 'Do not classify automatically', 'deleted_at' => now()]);
    $before = DB::table('annotations')->orderBy('id')->get()->toJson();
    Artisan::call('annotations:timing-audit');
    $report = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);
    expect($report['read_only'])->toBeTrue()
        ->and($report['counts']['point'])->toBe(1)
        ->and($report['counts']['ambiguous_deleted'])->toBe(1)
        ->and($report['ambiguous'][0]['id'])->toBe((string) $unknown->id)
        ->and($report['classification_required'])->toBeTrue()
        ->and(Artisan::output())->not->toContain($known->body)->not->toContain($unknown->body)
        ->and(DB::table('annotations')->orderBy('id')->get()->toJson())->toBe($before);
});

it('restricts intentional overlapping playback fixtures to local and testing environments', function () {
    $this->app->detectEnvironment(fn () => 'production');
    $code = Artisan::call('annotations:seed', ['review' => 999999]);
    expect($code)->toBe(1)
        ->and(Artisan::output())->toContain('restricted')
        ->and(Annotation::count())->toBe(0);
});
