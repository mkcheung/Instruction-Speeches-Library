import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { selectPlaybackMode } from './commentary-test-helpers.js'
import { xsrfHeaders } from './xsrf-headers.js'

const APP = 'http://127.0.0.1:5180'
const API = 'http://127.0.0.1:8180'
test.skip(!process.env.PLATFORM_DRY_VERIFY_WRAPPER, 'Requires a separate guarded platform verification database.')

interface Fixture { owner: { email: string; name: string }; speechId: number; search: string; singleReviewer: string }

/** New, uniquely named fixtures only. No reset or development seeder is invoked. */
function fixture(directory = false, malformedPreference = false): Fixture {
  const wrapper = process.env.PLATFORM_DRY_VERIFY_WRAPPER
  if (!wrapper) throw new Error('Requires the explicit isolated platform wrapper.')
  const php = String.raw`
require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$database = config('database.connections.pgsql.database');
if (! app()->environment('testing') || config('database.default') !== 'pgsql'
    || ! is_string($database) || ! preg_match('/^annotation_range_browser_dry_[a-z0-9_]+$/D', $database)
    || config('database.connections.pgsql.url') || config('database.connections.pgsql.host') !== '127.0.0.1'
    || (string) config('database.connections.pgsql.port') !== '15436'
    || Illuminate\Support\Facades\DB::selectOne('select current_database() as name')->name !== $database) {
    throw new RuntimeException('Refusing a non-isolated platform fixture database.');
}
$prefix = 'pd'.bin2hex(random_bytes(4));
$make = function (string $key, string $first, string $last, string $role) use ($prefix) {
    $user = App\Models\User::factory()->create(['username'=>$prefix.'-'.$key, 'email'=>$prefix.'-'.$key.'@example.invalid',
        'first_name'=>$first, 'last_name'=>$last]);
    $user->assignRole($role);
    $user->profile()->update(['display_name'=>trim($first.' '.$last), 'onboarding_completed_at'=>now()]);
    return $user;
};
$owner = $make('owner', 'Platform', 'Owner '.$prefix, 'member');
if (getenv('PLATFORM_DRY_MALFORMED') === '1') {
    $owner->update(['preferences'=>['voice_commentary'=>'invalid', 'unrelated'=>['preserved'=>true]]]);
}
$speech = App\Models\Speech::factory()->for($owner)->create(['title'=>'Platform validation '.$prefix]);
App\Models\SpeechAsset::factory()->video()->ready()->for($speech)->create(['duration_seconds'=>6, 'path'=>'isolated-fixture.mp4']);
if (getenv('PLATFORM_DRY_MALFORMED') === '1') {
    $reviewer = $make('commentator', 'Commentary', 'Coach '.$prefix, 'coach');
    $review = App\Models\Review::factory()->published()->create(['speech_id'=>$speech->id,
        'speech_owner_id'=>$owner->id, 'reviewer_id'=>$reviewer->id, 'annotations_count'=>1, 'published_annotations_count'=>1]);
    App\Models\Annotation::factory()->for($review)->create(['start_seconds'=>1, 'duration_seconds'=>1,
        'body'=>'Published platform feedback', 'published_at'=>now()]);
}
if (getenv('PLATFORM_DRY_DIRECTORY') === '1') {
    for ($i=0; $i<22; $i++) $make('coach-'.$i, 'Directory '.$prefix, 'Person '.str_pad((string)$i,2,'0',STR_PAD_LEFT), 'coach');
}
echo json_encode(['owner'=>['email'=>$owner->email, 'name'=>$owner->profile->display_name],
    'speechId'=>$speech->id, 'search'=>'Directory '.$prefix, 'singleReviewer'=>$prefix.'-coach-0'], JSON_THROW_ON_ERROR);
`
  return JSON.parse(execFileSync('python3', [wrapper, 'php', '-r', php], {
    cwd: path.resolve(import.meta.dirname, '../../api'), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PLATFORM_DRY_DIRECTORY: directory ? '1' : '0', PLATFORM_DRY_MALFORMED: malformedPreference ? '1' : '0' },
  })) as Fixture
}

async function login(page: Page, data: Fixture) {
  await page.goto(`${APP}/login`)
  await page.getByLabel('Email', { exact: true }).fill(data.owner.email)
  await page.getByLabel('Password', { exact: true }).fill('password')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(`${APP}/dashboard`)
}

test('reviewer filters reset paging and two invitations retain the directory state', async ({ page }) => {
  const data = fixture(true)
  await login(page, data)
  await page.goto(`${APP}/reviewers`)
  const search = page.getByRole('textbox', { name: 'Search by name or username', exact: true })
  await search.fill(data.search)
  await expect(page.getByText('22 reviewers', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await search.fill(data.singleReviewer)
  await expect(page.getByText('1 reviewer', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Members', exact: true }).click()
  await expect(page.getByText('No reviewers found.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Coaches', exact: true }).click()
  await expect(page.getByText('1 reviewer', { exact: true })).toBeVisible()

  await page.goto(`${APP}/speeches/${data.speechId}`)
  await page.getByRole('tab', { name: 'Reviewers', exact: true }).click()
  const panel = page.getByTestId('invite-reviewer-panel')
  await panel.getByRole('textbox', { name: 'Search the reviewer directory', exact: true }).fill(data.search)
  await panel.getByRole('button', { name: 'Coaches', exact: true }).click()
  await expect(panel.getByText('Page 1 of 2', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(panel.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  const candidates = panel.getByRole('button', { name: new RegExp(data.search) })
  await expect(candidates).toHaveCount(2)
  await candidates.first().click()
  await panel.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await expect(panel.getByText(/^Invitation sent to /)).toBeVisible()
  await panel.getByRole('button', { name: 'Invite someone else', exact: true }).click()
  await expect(panel.getByRole('textbox', { name: 'Search the reviewer directory', exact: true })).toHaveValue(data.search)
  await expect(panel.getByRole('button', { name: 'Coaches', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByText('Page 2 of 2', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Send invitation', exact: true })).toBeDisabled()
  await candidates.nth(1).click()
  await panel.getByRole('button', { name: 'Send invitation', exact: true }).click()
  await expect(panel.getByText(/^Invitation sent to /)).toBeVisible()
})

test('shared profile limits reject oversized text and save the boundary value', async ({ page }) => {
  const data = fixture()
  await login(page, data)
  await page.goto(`${APP}/profile`)
  await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('b'.repeat(1001))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Bio must be at most 1000 characters.', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('b'.repeat(1000))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Bio', exact: true })).toHaveValue('b'.repeat(1000))
})

test('an explicit legacy preference write repairs only its namespace and preserves canonical playback', async ({ page }) => {
  const data = fixture(false, true)
  await login(page, data)
  await page.goto(`${APP}/speeches/${data.speechId}`)
  await selectPlaybackMode(page, 'Written notes only')
  const headers = { Accept: 'application/json', Origin: APP, ...await xsrfHeaders(page.context(), API) }
  const legacy = await page.request.patch(`${API}/api/me/preferences/voice-commentary/${data.speechId}`, {
    headers, data: { mode: 'play', experienced: true },
  })
  expect(legacy.status()).toBe(200)
  expect((await legacy.json()).voice_commentary).toMatchObject({ mode: 'play', experienced: true })
  const canonical = await page.request.get(`${API}/api/me/preferences/commentary-playback/${data.speechId}`, { headers })
  expect(canonical.status()).toBe(200)
  expect((await canonical.json()).commentary_playback).toMatchObject({ mode: 'written', source: 'saved' })
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Written notes only', exact: true })).toBeChecked()
})
