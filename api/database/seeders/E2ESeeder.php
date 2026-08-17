<?php

namespace Database\Seeders;

use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Fixed ids, literal timestamps — NEVER now() (STEP-01-identity.md). This
 * seeder is explicitly expected to grow across every future step, so it is
 * structured for extension: one method per concern (users, profiles, roles
 * today; later steps add speeches/reviews/etc. as their own methods called
 * from run()), rather than one flat blob that gets harder to extend safely
 * each time.
 *
 * All four seed users share the password "password" and a fixed
 * `email_verified_at`/profile timestamp of 2026-01-01 00:00:00 UTC so the
 * fixture is byte-for-byte reproducible across every run and every
 * developer's machine.
 */
class E2ESeeder extends Seeder
{
    private const FIXTURE_TIMESTAMP = '2026-01-01 00:00:00';

    /**
     * Fixed, hardcoded user ids — deliberately outside the range
     * autoincrement would normally produce from a clean migrate, so a
     * seeded id collision with test-created users is obvious rather than
     * silent.
     */
    public const SUPER_ADMIN_ID = 9001;

    public const ADMIN_ID = 9002;

    public const COACH_ID = 9003;

    public const MEMBER_ID = 9004;

    /**
     * A SECOND coach, added for CP-05 (two-users-one-test). Reviewer
     * isolation — "Reviewer A cannot read Reviewer B's review and cannot
     * see that B exists" (§7.3, STEP-05) — is unprovable with only one
     * reviewer in the fixture, because there is no B to leak.
     */
    public const COACH_B_ID = 9005;

    /** The one speech both coaches review, so isolation has a subject. */
    public const SHARED_SPEECH_ID = 9101;

    public const REVIEW_COACH_A_ID = 9201;

    public const REVIEW_COACH_B_ID = 9202;

    /**
     * The `ready` primary video on the shared speech, added for CP-08
     * (testing a rich-text editor). See seedSharedReviewedSpeech()'s
     * docblock for why this row exists and why no bytes back it.
     */
    public const SHARED_SPEECH_ASSET_ID = 9301;

    /**
     * Reviewer A's PUBLISHED essay. Kept as a constant because
     * `web/tests/essay-editor.spec.ts` asserts the speaker can read this
     * exact text — a literal duplicated in two files drifts, a constant
     * mirrored in `web/tests/fixtures.ts` at least drifts loudly.
     *
     * Deliberately free of apostrophes and ampersands, which the sanitizer
     * entity-encodes. The trap is on the WRITE path, not the read one:
     * `EssayService::update()` sanitizes first and then derives
     * `essay_text` from the sanitized HTML with `strip_tags`, which does
     * not decode entities — so a reviewer who types `Bram's` gets
     * `Bram&#039;s` stored in `essay_text`, and any spec comparing
     * `essay_text` to what it typed fails against text that renders
     * perfectly in the browser. Keeping the fixture plain keeps that out of
     * the way of tests that are about something else.
     */
    public const ESSAY_COACH_A_HTML = '<p>The close landed better than the open.</p>';

    public const ESSAY_COACH_A_TEXT = 'The close landed better than the open.';

    public const ESSAY_COACH_A_WORDS = 7;

    /**
     * Fixture slug => the role that slug's user actually holds. Kept
     * separate from the slug because CP-05 needs two DIFFERENT users
     * ('coach', 'coach_b') holding the SAME role, which the previous
     * "array key is the role name" shortcut could not express.
     */
    private const ROLE_FOR_SLUG = [
        'super_admin' => 'super_admin',
        'admin' => 'admin',
        'coach' => 'coach',
        'coach_b' => 'coach',
        'member' => 'member',
    ];

    public function run(): void
    {
        $this->call(RoleSeeder::class);

        $users = $this->seedUsers();
        $this->seedProfiles($users);
        $this->seedRoles($users);
        $this->seedSharedReviewedSpeech($users);
    }

    /**
     * @return array<string, User>
     */
    private function seedUsers(): array
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $spec = [
            'super_admin' => ['id' => self::SUPER_ADMIN_ID, 'email' => 'super-admin@e2e.test', 'first_name' => 'Sadie', 'last_name' => 'Superadmin', 'username' => 'e2e-super-admin'],
            'admin' => ['id' => self::ADMIN_ID, 'email' => 'admin@e2e.test', 'first_name' => 'Adam', 'last_name' => 'Admin', 'username' => 'e2e-admin'],
            'coach' => ['id' => self::COACH_ID, 'email' => 'coach@e2e.test', 'first_name' => 'Cora', 'last_name' => 'Coach', 'username' => 'e2e-coach'],
            'coach_b' => ['id' => self::COACH_B_ID, 'email' => 'coach-b@e2e.test', 'first_name' => 'Bram', 'last_name' => 'Bystander', 'username' => 'e2e-coach-b'],
            'member' => ['id' => self::MEMBER_ID, 'email' => 'member@e2e.test', 'first_name' => 'Milo', 'last_name' => 'Member', 'username' => 'e2e-member'],
        ];

        $users = [];

        foreach ($spec as $role => $attrs) {
            $users[$role] = User::query()->updateOrCreate(
                ['id' => $attrs['id']],
                [
                    'email' => $attrs['email'],
                    'first_name' => $attrs['first_name'],
                    'last_name' => $attrs['last_name'],
                    'username' => $attrs['username'],
                    'username_changed_at' => $timestamp,
                    'password' => Hash::make('password'),
                    'email_verified_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ]
            );
        }

        return $users;
    }

    /**
     * @param  array<string, User>  $users
     */
    private function seedProfiles(array $users): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        foreach ($users as $role => $user) {
            Profile::query()->updateOrCreate(
                ['user_id' => $user->id],
                [
                    'display_name' => "{$user->first_name} {$user->last_name}",
                    'bio' => "E2E fixture profile for the {$role} role.",
                    'pronouns' => null,
                    'location' => 'Fixture City',
                    'timezone' => 'UTC',
                    'locale' => 'en',
                    'onboarding_completed_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ]
            );
        }
    }

    /**
     * @param  array<string, User>  $users
     */
    private function seedRoles(array $users): void
    {
        foreach ($users as $slug => $user) {
            $user->syncRoles([self::ROLE_FOR_SLUG[$slug]]);
        }
    }

    /**
     * One speech owned by the member, reviewed by BOTH coaches, each with
     * an accepted (access-granting) review.
     *
     * This is the CP-05 fixture: the isolation requirement it proves —
     * "Reviewer A cannot read Reviewer B's review and cannot see that B
     * exists" (§7.3) — needs two live grants on one subject, and needs
     * them set up by the fastest route rather than by clicking the
     * invitation flow twice (CP-05: "a test should set up by the fastest
     * route and assert through the UI").
     *
     * A `ready` primary video asset IS seeded, but no bytes back it — see
     * seedReadyVideoAsset() for the full reasoning. Until CP-08 this
     * fixture deliberately seeded no asset at all ("a `ready` asset would
     * need a real transcoded object in SeaweedFS, and the access-control
     * behaviour CP-05 tests does not depend on playback"). That held right
     * up until something needed to reach the reviewer's tab strip, which
     * `SpeechWatch.tsx` gates on a ready asset — see below.
     *
     * @param  array<string, User>  $users
     */
    private function seedSharedReviewedSpeech(array $users): void
    {
        $timestamp = Carbon::parse(self::FIXTURE_TIMESTAMP);

        $speech = Speech::query()->updateOrCreate(
            ['id' => self::SHARED_SPEECH_ID],
            [
                // Fixed, not Str::ulid()/Str::uuid() — the model's `creating`
                // hook would otherwise generate a different pair on every
                // fresh seed, breaking this fixture's reproducibility.
                'ulid' => '01JQE2ESEEDSPEECH000000001',
                'playback_key' => '9d1e5f00-0000-4000-8000-000000000101',
                'user_id' => $users['member']->id,
                'title' => 'E2E shared speech (two reviewers)',
                'description' => 'Fixture speech carrying one accepted review per coach, for reviewer-isolation tests.',
                'is_example' => false,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]
        );

        $this->seedReadyVideoAsset($speech);

        $reviews = [
            self::REVIEW_COACH_A_ID => $users['coach'],
            self::REVIEW_COACH_B_ID => $users['coach_b'],
        ];

        foreach ($reviews as $reviewId => $reviewer) {
            Review::query()->updateOrCreate(
                ['id' => $reviewId],
                [
                    'speech_id' => $speech->id,
                    'reviewer_id' => $reviewer->id,
                    'speech_owner_id' => $users['member']->id,
                    'invited_by_id' => $users['member']->id,
                    'invitation_message' => 'Fixture invitation.',
                    'allow_preview' => false,
                    'prior_commentary_shared' => false,
                    // NOT changed by CP-08's essay columns below, and must
                    // not be: E2ESeederSharedSpeechTest asserts 'accepted'
                    // for both reviews, and EssayService deliberately does
                    // not transition accepted -> in_progress on an essay
                    // write (unlike annotations), so writing one in a spec
                    // leaves this alone too.
                    'status' => 'accepted',
                    'invited_at' => $timestamp,
                    'responded_at' => $timestamp,
                    'last_transition_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                    // CP-08: every one of the six essay columns is written
                    // EXPLICITLY, including the nulls and zeroes. Naming
                    // only the non-default ones would leave the rest to
                    // whatever the last test run happened to store —
                    // `updateOrCreate` writes what you list and nothing
                    // else, so a published essay or a bumped lock_version
                    // would survive every future re-seed. Publish is a
                    // one-way door otherwise: EssayEditorPanel disables the
                    // button on `essay_published_at`, so a publish spec
                    // would pass exactly once and then fail forever.
                    ...$this->essayColumnsFor($reviewId, $timestamp),
                ]
            );
        }
    }

    /**
     * The `ready` primary video CP-08 needs, backed by no actual object.
     *
     * `SpeechWatch.tsx` gates the REVIEWER's whole tab strip — Notes and
     * Essay both — on `asset?.status === 'ready' && initialUrl`. Without a
     * row here the essay editor simply never mounts, so no browser test can
     * reach the real TipTap instance at all. (The SPEAKER's strip is gated
     * on ownership only, which is why the read-only half worked without
     * this.)
     *
     * No file is uploaded to SeaweedFS and none is needed:
     * `SpeechUploadController::playbackUrl` checks `status === 'ready'` and
     * then hands the path to `MediaUrlSigner::presign`, which is pure SigV4
     * signature math and never asks the store whether the object exists. So
     * `initialUrl` resolves, the gate opens, and the tab strip renders.
     *
     * The consequence, stated plainly so nobody debugs it later: the
     * <video> element WILL fail to load, and that is fine. This fixture
     * exists to unlock a rich-text editor, not to test playback. Anything
     * that actually needs pixels needs a real transcoded object and should
     * say so loudly rather than quietly leaning on this row.
     */
    private function seedReadyVideoAsset(Speech $speech): void
    {
        // Query builder, not `SpeechAsset::updateOrCreate` — the model
        // blocks mass assignment of `id`, and the fixed id is the whole
        // point (same reasoning as the fixed user/speech ids above).
        DB::table('speech_assets')->updateOrInsert(
            ['id' => self::SHARED_SPEECH_ASSET_ID],
            [
                'speech_id' => $speech->id,
                'kind' => 'video',
                'format' => 'mp4',
                'rendition' => 'source',
                'disk' => 'media',
                'path' => 'e2e/9101/source.mp4',
                'original_filename' => 'e2e-fixture.mp4',
                'mime_type' => 'video/mp4',
                'byte_size' => 1024,
                'duration_seconds' => 12.5,
                'status' => 'ready',
                // Both required by `Speech::primaryVideo()`, which scopes
                // on kind='video' AND is_primary=true.
                'is_primary' => true,
                'width' => 1280,
                'height' => 720,
                'created_at' => Carbon::parse(self::FIXTURE_TIMESTAMP),
                'updated_at' => Carbon::parse(self::FIXTURE_TIMESTAMP),
            ]
        );
    }

    /**
     * The six essay columns, per review.
     *
     * Reviewer A carries a PUBLISHED essay — the thing the speaker reads
     * and the thing reviewer B must be unable to reach. Reviewer B carries
     * an empty draft — the blank page specs type into. Splitting the two
     * roles across two reviews is what lets the write specs and the read
     * specs run without fighting over one row.
     *
     * @return array<string, string|int|Carbon|null>
     */
    private function essayColumnsFor(int $reviewId, Carbon $timestamp): array
    {
        if ($reviewId === self::REVIEW_COACH_A_ID) {
            return [
                'essay_html' => self::ESSAY_COACH_A_HTML,
                'essay_text' => self::ESSAY_COACH_A_TEXT,
                'essay_words' => self::ESSAY_COACH_A_WORDS,
                'essay_published_at' => $timestamp,
                'essay_updated_at' => $timestamp,
                // 1, not 0 — this essay has been written once, and a
                // fixture whose lock_version disagrees with its content is
                // the kind of detail that makes a conflict test lie.
                'essay_lock_version' => 1,
            ];
        }

        return [
            'essay_html' => null,
            'essay_text' => null,
            'essay_words' => 0,
            'essay_published_at' => null,
            'essay_updated_at' => null,
            'essay_lock_version' => 0,
        ];
    }
}
