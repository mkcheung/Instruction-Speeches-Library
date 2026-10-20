<?php

/** Fresh isolated browser database only; no reset, external media or mail. */
use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

require __DIR__.'/../api/vendor/autoload.php';
$app = require __DIR__.'/../api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$database = config('database.connections.pgsql.database');
if (config('app.env') !== 'testing' || config('database.default') !== 'pgsql'
    || ! is_string($database) || ! preg_match('/^annotation_range_browser_[a-z0-9_]+$/D', $database)
    || config('database.connections.pgsql.url') || DB::selectOne('select current_database() as name')->name !== $database
    || Schema::hasTable('users')) {
    throw new RuntimeException('Requires a fresh annotation_range_browser_* PostgreSQL test database. No reset is performed.');
}
Artisan::call('migrate', ['--force' => true]);
Artisan::call('db:seed', ['--class' => RoleSeeder::class, '--force' => true]);
$owner = User::factory()->create(['email' => 'range-owner@e2e.test', 'username' => 'range-owner', 'first_name' => 'Range', 'last_name' => 'Owner']);
$owner->assignRole('member');
$coach = User::factory()->create(['email' => 'range-coach@e2e.test', 'username' => 'range-coach', 'first_name' => 'Range', 'last_name' => 'Coach']);
$coach->assignRole('coach');
foreach ([$owner, $coach] as $user) {
    Profile::query()->updateOrCreate(['user_id' => $user->id], ['display_name' => $user->first_name.' '.$user->last_name,
        'timezone' => 'UTC', 'locale' => 'en', 'onboarding_completed_at' => now()]);
}
$rows = [];
for ($index = 0; $index < 9; $index++) {
    $speech = Speech::factory()->for($owner)->create(['title' => 'Annotation range browser check '.($index + 1)]);
    SpeechAsset::factory()->video()->ready()->for($speech)->create(['duration_seconds' => 6, 'path' => 'isolated-fixture.mp4']);
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $owner->id,
        'reviewer_id' => $coach->id, 'status' => 'in_progress']);
    $rows[] = ['speech_id' => $speech->id, 'review_id' => $review->id];
}
echo json_encode(['database' => $database, 'fixtures' => $rows, 'mail' => 'array', 'media' => 'local test directory'], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n";
