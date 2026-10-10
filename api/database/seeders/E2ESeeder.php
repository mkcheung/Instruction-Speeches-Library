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

    /**
     * A third coach whose review of the shared speech has been REVOKED.
     * Added by PLAN-ACCESS-DENIED-STATES.md §5.3: the new 403 branch in
     * SpeechController::show is unreachable in a browser without a revoked
     * row, and the database had none.
     *
     * Deliberately a NEW coach rather than reusing coach A or B:
     * `uq_reviews_speech_reviewer` permits only one review row per
     * (speech, reviewer), so revoking either existing coach would have
     * meant mutating a fixture that E2ESeederSharedSpeechTest asserts is
     * `accepted` and that the reviewer-isolation specs depend on.
     */
    public const COACH_C_ID = 9006;

    /**
     * PLAN-ADMIN-DASHBOARD.md §9 — the two TOTP secrets that make the
     * Filament panel reachable by a browser at all.
     *
     * `AdminPanelProvider` sets `multiFactorAuthentication([
     * AppAuthentication::make()], isRequired: true)`, and that `isRequired`
     * installs `EnsureMultiFactorAuthenticationIsEnabled` on every panel
     * page route. Its only test is
     * `filled($user->getAppAuthenticationSecret())` — so an admin seeded
     * WITHOUT a secret is redirected into Filament's mandatory enrollment
     * flow (QR code, confirm, recovery codes) instead of the panel, and
     * `web/tests/admin-panel.spec.ts` could never reach a single panel
     * surface. These two columns are the entire fix; nothing in the panel
     * ever checks `two_factor_confirmed_at`.
     *
     * ## Why a hardcoded secret is safe here
     *
     * These are base32 TOTP seeds for two accounts that exist only in a
     * disposable E2E/dev database, whose password is already the literal
     * string "password" in this same file. They buy an attacker nothing
     * that the password does not already give away. They are hardcoded
     * rather than generated because `web/tests/panel-auth.ts` has to
     * derive the same six digits in Node, and a generated secret would
     * have to be exported from the database to the test runner somehow.
     *
     * ## Why the two accounts get DIFFERENT secrets
     *
     * `AppAuthentication::verifyCode(..., shouldPreventCodeReuse: true)`
     * caches the last accepted timestep under
     * `filament.app_authentication_codes.md5($secret)` and then requires
     * every later code to be strictly NEWER (RFC 6238). Two users sharing
     * one secret would therefore share one reuse counter, and the admin
     * and super_admin logins — which run within seconds of each other —
     * would knock each other out roughly half the time. Separate secrets
     * give them separate counters.
     *
     * Each must be valid base32 (A-Z, 2-7) and a multiple of 8 characters;
     * 16 is what `AppAuthentication::generateSecret()` itself produces.
     * `php artisan tinker` cross-check, against the Node implementation in
     * `web/tests/panel-auth.ts`:
     *
     *     (new PragmaRX\Google2FA\Google2FA)->getCurrentOtp('E2EADMINE2EADMIN')
     *
     * agrees digit-for-digit with `totp('E2EADMINE2EADMIN')` there.
     *
     * ⚠️ Fortify's own two-factor feature is NOT enabled
     * (`config/fortify.php` lists registration, resetPasswords,
     * emailVerification, updateProfileInformation, updatePasswords and
     * nothing else), so `RedirectIfTwoFactorAuthenticatable` is absent
     * from the login pipeline and these columns cannot affect the SPA
     * login for these two accounts. If that feature is ever switched on,
     * `E2ESeederRolesTest`'s `postJson('/login')` assertions for
     * super-admin@e2e.test / admin@e2e.test are the canary.
     */
    public const SUPER_ADMIN_TOTP_SECRET = 'E2ESUPERADMIN234';

    public const ADMIN_TOTP_SECRET = 'E2EADMINE2EADMIN';

    /** The one speech both coaches review, so isolation has a subject. */
    public const SHARED_SPEECH_ID = 9101;

    public const REVIEW_COACH_A_ID = 9201;

    public const REVIEW_COACH_B_ID = 9202;

    /**
     * Coach C's revoked review of the shared speech. Invisible to the
     * speaker's roster (`ReviewController::forSpeech` filters both
     * ACCESS_GRANTING and `revoked_at IS NULL`), so it does not disturb
     * E2ESeederSharedSpeechTest's exact two-reviewer assertion.
     */
    public const REVIEW_COACH_C_REVOKED_ID = 9203;

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
        'coach_c' => 'coach',
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
            'super_admin' => ['id' => self::SUPER_ADMIN_ID, 'email' => 'super-admin@e2e.test', 'first_name' => 'Sadie', 'last_name' => 'Superadmin', 'username' => 'e2e-super-admin', 'totp_secret' => self::SUPER_ADMIN_TOTP_SECRET],
            'admin' => ['id' => self::ADMIN_ID, 'email' => 'admin@e2e.test', 'first_name' => 'Adam', 'last_name' => 'Admin', 'username' => 'e2e-admin', 'totp_secret' => self::ADMIN_TOTP_SECRET],
            'coach' => ['id' => self::COACH_ID, 'email' => 'coach@e2e.test', 'first_name' => 'Cora', 'last_name' => 'Coach', 'username' => 'e2e-coach'],
            'coach_b' => ['id' => self::COACH_B_ID, 'email' => 'coach-b@e2e.test', 'first_name' => 'Bram', 'last_name' => 'Bystander', 'username' => 'e2e-coach-b'],
            'coach_c' => ['id' => self::COACH_C_ID, 'email' => 'coach-c@e2e.test', 'first_name' => 'Cyrus', 'last_name' => 'Cutoff', 'username' => 'e2e-coach-c'],
            'member' => ['id' => self::MEMBER_ID, 'email' => 'member@e2e.test', 'first_name' => 'Milo', 'last_name' => 'Member', 'username' => 'e2e-member'],
        ];

        $users = [];

        foreach ($spec as $role => $attrs) {
            $totpSecret = $attrs['totp_secret'] ?? null;

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
                    // Only the two admin-tier fixtures carry one; see the
                    // constants' docblock. Written through the model (not
                    // DB::table) on purpose — `two_factor_secret` has an
                    // `encrypted` cast, so a raw insert would store the
                    // plaintext and `getAppAuthenticationSecret()` would
                    // throw on decrypt instead of returning the seed.
                    'two_factor_secret' => $totpSecret,
                    // Unused by Filament (`isEnabled()` only checks the
                    // secret) but set anyway so the row is not in Fortify's
                    // half-enrolled state, which its own flow treats as
                    // "secret issued, never confirmed".
                    'two_factor_confirmed_at' => $totpSecret === null ? null : $timestamp,
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
            self::REVIEW_COACH_C_REVOKED_ID => $users['coach_c'],
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
                    // PLAN-ACCESS-DENIED-STATES.md §5.3. Written for every
                    // review, not only the revoked one, for the same reason
                    // the essay columns are: `updateOrCreate` writes what you
                    // list and nothing else, so omitting these for A and B
                    // would let a revoke performed by a spec survive every
                    // future re-seed and silently turn an `accepted` fixture
                    // into a revoked one.
                    ...$this->revocationColumnsFor($reviewId, $timestamp),
                ]
            );
        }
    }

    /**
     * Revocation state per review. Only coach C's row carries a tombstone;
     * A and B are explicitly reset to null so a spec that revokes one of
     * them cannot leave the fixture permanently revoked.
     *
     * Note `status` is deliberately left as `'accepted'` even on the revoked
     * row: `revoked_at` is orthogonal to `status` in this schema (there is no
     * `revoked` value in `ck_reviews_status`), and ReviewService::revoke
     * tombstones in place without touching status — so a fixture that
     * rewrote status here would not resemble a real revocation.
     *
     * @return array<string, string|Carbon|int|null>
     */
    private function revocationColumnsFor(int $reviewId, Carbon $timestamp): array
    {
        if ($reviewId === self::REVIEW_COACH_C_REVOKED_ID) {
            return [
                'revoked_at' => $timestamp,
                'revoked_by_id' => self::MEMBER_ID,
                // Free text the speaker wrote. The 403 response must never
                // echo this, and ReviewInvitationHttpTest asserts as much —
                // but the reviewer's own dashboard DOES still show it
                // (§1 Option A), which is why a realistic value belongs here
                // rather than a blank.
                'revocation_reason' => 'Reassigning this speech to a different coach.',
            ];
        }

        return [
            'revoked_at' => null,
            'revoked_by_id' => null,
            'revocation_reason' => null,
        ];
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
