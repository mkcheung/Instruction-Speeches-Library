<?php

use App\Jobs\PurgeSpeechMedia;
use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Support\AuditAction;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.6 / §1.3. Before this job, taking a speech down
 * soft-deleted the row, which means the `ON DELETE CASCADE` on
 * `speech_assets` never fired and every byte survived forever — and no sweep
 * reclaimed them, the retained-originals prune included (its `Speech::query()`
 * cannot see a trashed speech).
 *
 * The invariant under test in every case below is the §11.2 trade: bytes go
 * only after the quarantine window, and a restore inside it still has media.
 */

/**
 * Builds a taken-down speech with one asset of every kind, including a
 * reviewer's voice note, with real bytes behind each path.
 *
 * @return array{speech: Speech, speaker: User, assets: array<string, SpeechAsset>}
 */
function takenDownSpeechWithMedia(int $daysAgo, int $sourceBytes = 10_000_000): array
{
    $speaker = User::factory()->create([
        'storage_bytes_used' => $sourceBytes,
        'quota_bytes' => 100_000_000,
    ]);
    $reviewer = User::factory()->create(['storage_bytes_used' => 2_000_000, 'quota_bytes' => 100_000_000]);
    $speech = Speech::factory()->for($speaker)->create();

    $assets = [
        // Only a `ready` source is charged to the speaker's quota — see the
        // job's QUOTA note.
        'source' => SpeechAsset::factory()->for($speech)->create(['status' => 'ready', 'byte_size' => $sourceBytes]),
        'video' => SpeechAsset::factory()->for($speech)->video()->ready()->create(['byte_size' => 4_000_000]),
        'poster' => SpeechAsset::factory()->for($speech)->poster()->create(['status' => 'ready', 'byte_size' => 50_000]),
        'sprite' => SpeechAsset::factory()->for($speech)->sprite()->create(['status' => 'ready', 'byte_size' => 90_000]),
        'captions' => SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'ready', 'byte_size' => 4_000]),
        'voice_note' => SpeechAsset::factory()->for($speech)->voiceNote()->create(['status' => 'ready', 'byte_size' => 2_000_000]),
    ];

    foreach ($assets as $asset) {
        Storage::disk('media')->put($asset->path, 'bytes-for-'.$asset->kind);
    }

    // The voice note belongs to the reviewer, through an annotation on a
    // review — the relationship that makes it a third party's content rather
    // than the speaker's.
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'speech_owner_id' => $speaker->id,
        'reviewer_id' => $reviewer->id,
        'status' => 'in_progress',
    ]);
    Annotation::factory()->for($review)->create([
        'audio_asset_id' => $assets['voice_note']->id,
        'transcript_status' => 'ready',
    ]);

    $speech->delete();
    Speech::withTrashed()->whereKey($speech->id)->update(['deleted_at' => now()->subDays($daysAgo)]);

    return ['speech' => $speech, 'speaker' => $speaker, 'assets' => $assets];
}

function purge(Speech $speech, ?int $quarantineDays = null): void
{
    (new PurgeSpeechMedia($speech, $quarantineDays))->handle(app(QuotaService::class));
}

it('purges every speaker-owned kind once the quarantine window has passed, and spares the reviewer voice note', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'assets' => $assets] = takenDownSpeechWithMedia(daysAgo: 31);

    purge($speech);

    foreach (['source', 'video', 'poster', 'sprite', 'captions'] as $kind) {
        expect(Storage::disk('media')->exists($assets[$kind]->path))->toBeFalse("{$kind} bytes should be gone");
        expect(SpeechAsset::query()->whereKey($assets[$kind]->id)->exists())->toBeFalse("{$kind} row should be gone");
    }

    // The reviewer's audio is untouched: a takedown of the speech is not a
    // finding against the coach's commentary (AccountErasureService draws the
    // same line with `where('kind', '!=', 'voice_note')`).
    expect(Storage::disk('media')->exists($assets['voice_note']->path))->toBeTrue();
    expect(SpeechAsset::query()->whereKey($assets['voice_note']->id)->exists())->toBeTrue();
});

it('writes one SPEECH_MEDIA_PURGED audit row describing what it removed and what it kept', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'speaker' => $speaker] = takenDownSpeechWithMedia(daysAgo: 31);

    purge($speech);

    $entry = AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->sole();

    // System actor: a scheduled consequence of the takedown, not an admin's
    // act 30 days later.
    expect($entry->actor_id)->toBeNull();
    expect($entry->subject_type)->toBe(Speech::class);
    expect($entry->subject_id)->toBe($speech->id);
    expect($entry->metadata['speech_ulid'])->toBe($speech->ulid);
    expect($entry->metadata['speech_owner_id'])->toBe($speaker->id);
    expect($entry->metadata['assets_purged'])->toBe(5);
    expect($entry->metadata['assets_purged_by_kind'])->toBe([
        'captions' => 1, 'poster' => 1, 'source' => 1, 'sprite' => 1, 'video' => 1,
    ]);
    expect($entry->metadata['bytes_freed'])->toBe(10_000_000 + 4_000_000 + 50_000 + 90_000 + 4_000);
    expect($entry->metadata['voice_notes_retained'])->toBe(1);
    expect($entry->metadata['quarantine_days'])->toBe(30);
});

/**
 * Quota follows BYTES, not rows: the takedown keeps charging the speaker
 * while the media is still restorable, and the charge drops when the bytes
 * actually go. Only the `ready` source was ever charged — the derived
 * renditions never touch QuotaService, so crediting them would hand back
 * quota that was never debited.
 */
it('credits back the ready source bytes only, never the uncharged derived renditions', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'speaker' => $speaker] = takenDownSpeechWithMedia(daysAgo: 31, sourceBytes: 10_000_000);

    purge($speech);

    expect($speaker->fresh()->storage_bytes_used)->toBe(0);
});

it('leaves a speech still inside the quarantine window completely untouched', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'speaker' => $speaker, 'assets' => $assets] = takenDownSpeechWithMedia(daysAgo: 1);

    purge($speech);

    foreach ($assets as $asset) {
        expect(Storage::disk('media')->exists($asset->path))->toBeTrue();
        expect(SpeechAsset::query()->whereKey($asset->id)->exists())->toBeTrue();
    }
    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->exists())->toBeFalse();
    expect($speaker->fresh()->storage_bytes_used)->toBe(10_000_000);
});

/**
 * The seam with the takedown action, which dispatches this job EAGERLY
 * (`PurgeSpeechMedia::dispatch($record)` in SpeechResource, no `->delay()`).
 * The job therefore runs seconds after the soft delete, and the quarantine
 * exists only because the window is re-checked inside the job rather than
 * trusted from the dispatch site. If that check is ever removed, every
 * takedown becomes an immediate, unrecoverable deletion — this test is the
 * thing that fails first.
 */
it('refuses the purge a takedown dispatches immediately, leaving it to the sweep', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'assets' => $assets] = takenDownSpeechWithMedia(daysAgo: 0);

    purge($speech);

    foreach ($assets as $asset) {
        expect(Storage::disk('media')->exists($asset->path))->toBeTrue();
    }
    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->exists())->toBeFalse();
});

/**
 * §6.3's restore action, and the whole reason §11.2 chose a window over an
 * immediate hard delete. The purge refuses on `deleted_at IS NULL` — so an
 * eager `PurgeSpeechMedia::dispatch($speech)` at takedown time cannot
 * out-race a restore either.
 */
it('refuses to purge a speech restored inside the window, even when the window has since elapsed', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'assets' => $assets] = takenDownSpeechWithMedia(daysAgo: 31);

    Speech::withTrashed()->whereKey($speech->id)->restore();

    purge($speech);

    foreach ($assets as $asset) {
        expect(Storage::disk('media')->exists($asset->path))->toBeTrue();
        expect(SpeechAsset::query()->whereKey($asset->id)->exists())->toBeTrue();
    }
    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->exists())->toBeFalse();
});

it('is idempotent: a second run writes no second audit row and credits no quota twice', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'speaker' => $speaker] = takenDownSpeechWithMedia(daysAgo: 31);

    purge($speech);
    $speaker->forceFill(['storage_bytes_used' => 7_000_000])->save(); // a later, unrelated upload
    purge($speech);

    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->count())->toBe(1);
    expect($speaker->fresh()->storage_bytes_used)->toBe(7_000_000);
});

/**
 * The retry-after-partial-failure path: a storage delete that fails throws
 * before the row is deleted, so the next attempt finds rows whose objects are
 * already gone. That must complete, not error.
 */
it('removes rows whose objects are already missing, without erroring', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech, 'assets' => $assets] = takenDownSpeechWithMedia(daysAgo: 31);

    Storage::disk('media')->delete($assets['video']->path);

    purge($speech);

    expect(SpeechAsset::query()->whereKey($assets['video']->id)->exists())->toBeFalse();
    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->count())->toBe(1);
});

/**
 * A job that outlives its speech: the speech was hard-deleted (account
 * erasure, which purges the bytes itself before force-deleting) while this
 * purge was still queued. The job must no-op, not throw and not log.
 *
 * It does NOT assert anything about the bytes, deliberately. The `ON DELETE
 * CASCADE` takes the `speech_assets` rows with the speech, so after a bare
 * force-delete there is nothing row-driven left for ANY sweep to find — the
 * job's "speech row absent, purge the survivors" branch only has survivors to
 * purge if the cascade was bypassed, which SQLite cannot reproduce here
 * (`PRAGMA foreign_keys` is a no-op inside RefreshDatabase's transaction).
 * Any future hard-delete path must therefore purge storage BEFORE deleting
 * the speech, exactly as AccountErasureService's steps 2-3 do.
 */
it('no-ops cleanly when the speech row is already gone', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['speech' => $speech] = takenDownSpeechWithMedia(daysAgo: 31);

    Speech::withTrashed()->whereKey($speech->id)->forceDelete();

    expect(fn () => purge($speech))->not->toThrow(Throwable::class);
    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->exists())->toBeFalse();
});

/**
 * The sweep, not the job: `media:reconcile` is what actually drives the purge
 * in production (§5.6 — a 30-day `->delay()` in Redis would not survive the
 * month). One command run must purge the expired speech, leave the quarantined
 * one alone, and never touch a live speech.
 */
it('purges only expired takedowns on a media:reconcile sweep', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    $expired = takenDownSpeechWithMedia(daysAgo: 31);
    $quarantined = takenDownSpeechWithMedia(daysAgo: 1);

    $liveSpeaker = User::factory()->create();
    $live = Speech::factory()->for($liveSpeaker)->create(['captions_enabled' => false]);
    $liveVideo = SpeechAsset::factory()->for($live)->video()->ready()->create();
    Storage::disk('media')->put($liveVideo->path, 'live-bytes');

    $this->artisan('media:reconcile')->assertSuccessful();

    expect(SpeechAsset::query()->whereKey($expired['assets']['video']->id)->exists())->toBeFalse();
    expect(Storage::disk('media')->exists($expired['assets']['video']->path))->toBeFalse();

    expect(SpeechAsset::query()->whereKey($quarantined['assets']['video']->id)->exists())->toBeTrue();
    expect(Storage::disk('media')->exists($quarantined['assets']['video']->path))->toBeTrue();

    expect(SpeechAsset::query()->whereKey($liveVideo->id)->exists())->toBeTrue();
    expect(Storage::disk('media')->exists($liveVideo->path))->toBeTrue();

    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->count())->toBe(1);
});

/**
 * The seam the job's `$quarantineDays` argument exists for: the sweep selects
 * on the overridden window and passes the same number down, so the job cannot
 * refuse work the command just selected.
 */
it('honours a --takedown-quarantine-days override end to end', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);

    ['assets' => $assets] = takenDownSpeechWithMedia(daysAgo: 2);

    $this->artisan('media:reconcile', ['--takedown-quarantine-days' => 1])->assertSuccessful();

    expect(SpeechAsset::query()->whereKey($assets['source']->id)->exists())->toBeFalse();
    expect(Storage::disk('media')->exists($assets['source']->path))->toBeFalse();
    expect(AuditLog::query()->where('action', AuditAction::SPEECH_MEDIA_PURGED)->sole()->metadata['quarantine_days'])->toBe(1);
});
