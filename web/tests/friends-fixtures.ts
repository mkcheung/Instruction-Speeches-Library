import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const FRIENDS_APP_URL = process.env.FRIENDS_APP_URL ?? 'http://127.0.0.1:5174'
export const FRIENDS_API_URL = process.env.FRIENDS_API_URL ?? 'http://127.0.0.1:18080'
export interface FriendTestPerson { id: number; email: string; username: string; name: string }
export interface FriendsFixture {
  alex: FriendTestPerson
  casey: FriendTestPerson
  morgan: FriendTestPerson
  drew: FriendTestPerson
  owen: FriendTestPerson
  admin: FriendTestPerson
  super: FriendTestPerson
  extra: FriendTestPerson[]
}

/** Opt-in, uniquely named fixtures in the separate verification database only.
 * Never invokes an existing E2E seeder, reset, deletion or development database.
 * Fixtures remain available for inspection until the disposable stack is stopped. */
export function createFriendsFixture(pagination = false): FriendsFixture {
  const wrapper = process.env.FRIENDS_VERIFY_WRAPPER
  if (!wrapper || new URL(FRIENDS_API_URL).hostname !== '127.0.0.1'
    || new URL(FRIENDS_API_URL).port !== '18080') throw new Error('Use the explicit isolated Friends verification stack.')
  const php = String.raw`
require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (config('database.default') !== 'pgsql' || config('database.connections.pgsql.database') !== 'friends_verify'
    || config('database.connections.pgsql.host') !== '127.0.0.1' || (string) config('database.connections.pgsql.port') !== '15435'
    || ! app()->environment(['testing', 'e2e'])) throw new RuntimeException('Refusing non-isolated fixture database.');
foreach (['member', 'coach', 'admin', 'super_admin'] as $role) Spatie\Permission\Models\Role::firstOrCreate(['name'=>$role, 'guard_name'=>'web']);
$prefix = 'fb'.bin2hex(random_bytes(4));
$people = [];
foreach (['alex'=>'Alex', 'casey'=>'Casey', 'morgan'=>'Morgan', 'drew'=>'Drew', 'owen'=>'Owen', 'admin'=>'Admin', 'super'=>'Superadmin'] as $key=>$first) {
    $user = new App\Models\User;
    $user->forceFill(['first_name'=>$first, 'last_name'=>'Browser '.$prefix, 'username'=>$prefix.'-'.$key,
        'email'=>$prefix.'-'.$key.'@example.invalid', 'password'=>Illuminate\Support\Facades\Hash::make('password'), 'email_verified_at'=>now()])->save();
    $user->profile()->update(['display_name'=>$first.' Browser '.$prefix, 'onboarding_completed_at'=>now()]);
    if ($key === 'admin' || $key === 'super') $user->assignRole(['member', $key === 'admin' ? 'admin' : 'super_admin']);
    elseif ($key === 'casey') $user->assignRole('coach');
    $people[$key]=$user;
}
$service=app(App\Services\ConnectionService::class);
$connect=function ($a,$b) use ($service) {
    $service->request($a,$b,null);
    $row=App\Models\Connection::where('owner_id',$b->id)->where('peer_id',$a->id)->firstOrFail();
    $service->accept($b,$row->id);
};
$connect($people['alex'],$people['morgan']);
$connect($people['casey'],$people['morgan']);
$service->request($people['drew'],$people['casey'],'A note with this incoming request.');
$service->request($people['casey'],$people['owen'],null);
$extra=[];
if (getenv('FRIENDS_BROWSER_PAGINATION') === '1') {
    for ($i=0;$i<24;$i++) {
        $user=new App\Models\User;
        $name='Pagination Friend '.str_pad((string)$i,2,'0',STR_PAD_LEFT).' '.$prefix;
        $user->forceFill(['first_name'=>$name,'last_name'=>'','username'=>$prefix.'-p'.$i,
            'email'=>$prefix.'-p'.$i.'@example.invalid','password'=>Illuminate\Support\Facades\Hash::make('password'),'email_verified_at'=>now()])->save();
        $user->profile()->update(['display_name'=>$name,'onboarding_completed_at'=>now()]);
        $connect($people['alex'],$user);$extra[]=$user;
    }
}
$serialize=fn($u)=>['id'=>$u->id,'email'=>$u->email,'username'=>$u->username,'name'=>$u->profile->display_name];
echo json_encode(array_map($serialize,$people)+['extra'=>array_map($serialize,$extra)],JSON_THROW_ON_ERROR);
`
  return JSON.parse(execFileSync('python3', [wrapper, 'php', '-r', php], {
    cwd: path.resolve(import.meta.dirname, '../../api'), encoding: 'utf8',
    env: { ...process.env, FRIENDS_BROWSER_PAGINATION: pagination ? '1' : '0' }, timeout: 30_000,
  })) as FriendsFixture
}

export async function loginFriend(page: Page, person: FriendTestPerson) {
  await page.goto(`${FRIENDS_APP_URL}/login`)
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(person.email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('password')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page).toHaveURL(`${FRIENDS_APP_URL}/dashboard`)
}

export async function friendPost(context: BrowserContext, endpoint: string, data?: unknown) {
  const cookie = (await context.cookies()).find((entry) => entry.name === 'XSRF-TOKEN')
  return context.request.post(`${FRIENDS_API_URL}${endpoint}`, {
    headers: { Accept: 'application/json', Origin: FRIENDS_APP_URL,
      ...(cookie ? { 'X-XSRF-TOKEN': decodeURIComponent(cookie.value) } : {}) }, data,
  })
}
