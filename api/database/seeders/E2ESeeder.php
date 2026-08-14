<?php

namespace Database\Seeders;

use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
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
     * No `speech_assets` row is seeded, so this speech renders "Not ready
     * to play yet." rather than a player. That is deliberate: a `ready`
     * asset would need a real transcoded object in SeaweedFS, and the
     * access-control behaviour CP-05 tests does not depend on playback.
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
                    'status' => 'accepted',
                    'invited_at' => $timestamp,
                    'responded_at' => $timestamp,
                    'last_transition_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ]
            );
        }
    }
}
