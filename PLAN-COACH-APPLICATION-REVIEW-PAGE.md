# Plan — Coach Application Review Page

**rev 5 · 2026-10-28 · branch `development` · not executed**

The ask, for `/control-panel/coach-applications`:

1. The list shows each application's status (approved, rejected, submitted, …)
   and nothing else actionable.
2. Each row links to a page that shows the applicant's original written
   request, with a tab that switches to their uploaded documents. Each document
   can be opened. The page stays inside the same panel chrome: the sidebar and
   the "Coach applications" header stay put.
3. That page has the button that approves the applicant as a coach.

Plus your four decisions, made on 2026-10-28 (§13):

| | Decision | Where |
|---|---|---|
| Q1 | Drafts never appear in the admin list | §4 |
| Q2 | Erasing an account shreds the applicant's coach statements and documents | §9 |
| Q3 | Approval is **blocked** until at least one document is clean | §7 |
| Q4 | Reapplying is fixed now: it starts a fresh application | §8 |

How this plan was built:
- Four read-only reviews covered the backend, the panel UI and SPA, the schema, and the Filament vendor source.
- An adversarial review (rev 2) and a final validation (rev 3) checked the plan against the code.
- Rev 4 added your decisions. Rev 5 applies the fixes and simplifications from validating rev 4.
- §15 lists every correction and records the final validation.

---

## 0. Summary

| | |
|---|---|
| **Can it be built?** | Yes. There is no migration and no SPA code change. The server changes are confined to the resource, one new page, the decision, submission and erasure services, and two models. |
| **Will the documents tab show anything today?** | **No.** Uploads never finish scanning on the dev stack: the documents disk is local to each container, so the queue worker can't see the app container's files (§2.1). Phase 0 fixes that first. |
| **Sidebar change needed?** | **No.** It is already sticky on desktop, and the nav item stays active on sub-pages (§2.4). |
| **Security and privacy changes** | <ul><li>The page gets an explicit admin-tier gate. The resource has no policy, so Filament's fallback currently allows everyone (§2.3).</li><li>The audit row moves from "modal rendered" to "download clicked".</li><li>The download controller stops returning 500 on purged rows and gains `CSP: sandbox`.</li><li>Approval requires a clean document.</li><li>Erasure shreds the applicant's coach data.</li></ul> |
| **Breakage** | <ul><li>4 Pest tests in `PanelModerationTest`: 2 move to the new page, 1 is rewritten, 1 loses a case.</li><li>The `CoachApplicationDecisionTest` fixture gains a clean document.</li><li>2 tests in `CoachApplicationHttpTest` change: one gains a clean document, the reapply test is rewritten.</li><li>1 test in `CoachApplicationAdmissionTest` is rewritten: it expected a POST against a withdrawn application to return 409.</li><li>Details in §10. No Playwright spec touches any of this.</li></ul> |
| **Contract changes** | Two frozen contracts are deliberately amended: STEP-12's "`rejected -> draft` reusing the row" (§8), and STEP-11's eight erasure steps, which gain a step 6c (§9). |

---

## 1. How the ask is read

- **"Show only the Approved/Rejected or whatever status."**
  - The list's columns are Applicant, Status (a coloured, labelled badge), Submitted and Decided.
  - The approve, reject and view-documents row buttons are replaced by one "Review" link.
  - The list widens from "undecided only" to **every status except `draft`** (Q1). Undecided rows sort to the top, so it still reads as a queue.
  - After §8, one applicant can appear on several rows, one per attempt. That is their history.
- **"A link putting up a page"** → a `ViewRecord` page at `/control-panel/coach-applications/{id}`, reached from the row or its "Review" link.
- **"A button/tab to switch to the documents"** → Filament schema tabs: **Request** | **Documents (n)**.
- **"Click on it and review the document"** → a **Download** button on each clean document.
  - Opening a user-supplied PDF *inline* on the panel is a non-negotiable "never" (`MODERNIZATION_PLAN.md:1134-1135`).
  - The PDF downloads and opens in the admin's own viewer, as it does today.
- **"A button to approve"** → Approve and Reject as page header actions.
  - Both are visible only while the application is undecided.
  - Approve is disabled until at least one document is clean (Q3).

---

## 2. Baseline — verified facts

### 2.1 Why the modal says "No clean documents yet": the dev stack can't finish a scan

- Document #1 (`Parking Permit Purchase.pdf`, application #2) is `pending_scan`.
- The file exists only in the **app** container (`storage/app/application_documents/applications/2/a1b69e29-….pdf`). The **queue-worker** container has no `applications/` directory at all.
- Why:
  - `application_documents` is a `local` disk at `storage_path('app/application_documents')` (`api/config/filesystems.php:115-120`).
  - `compose.yaml` mounts no volume there on `app`, `queue-worker` or `scheduler`, so each container has its own private copy of that directory.
- The queue-worker log has `"ScanApplicationDocument: document path missing on disk." document_id 1 @ 2026-10-28T23:19:49Z`. The job returns normally, so Horizon shows `DONE`.
- Separately, the images predate `42eae02` (R6, 2026-10-26).
  - Migration `2026_10_26_000001_add_work_columns_to_application_documents_table` is in neither the containers nor the DB.
  - Rebuilding without migrating makes things worse: the new code reads `work_attempts` and throws.
- The same split breaks the infected-cleanup phase and the retention purge. Both treat a missing file as already deleted and blank the row, while the bytes survive in the app container.

### 2.2 The resource today

`api/app/Filament/Resources/CoachApplicationResource.php`:

| Line(s) | What | Fate |
|---|---|---|
| 25-35 | Class docblock: "sandboxed-origin PDF viewer", "'View PDF' opens … in a new tab" | Rewritten (§10) |
| 57-62 | `form()`: a dead `decision_reason` Textarea | Emptied (§5.1) |
| 80 | `whereIn('status', ['submitted','under_review'])->orderBy('submitted_at')` | Replaced (§4) |
| 82-85 | Columns: applicant, raw status, submitted, docs count | Replaced (§4) |
| 88-91 | Status filter with two options | Widened (§4) |
| 94-145 | `viewDocuments` modal. Lists `clean` documents only, writes `ADMIN_VIEWED_DOCUMENT` for each listed document **on render**, and presigns each one | Removed (§5.4) |
| 146-183 | Hole-3 rationale comment for the decision actions | Moves with them (§5.5) |
| 184-217 | `approve` / `reject` row actions | Moved to the page header (§5.5) |
| 224-229 | `getPages()`: `index` only | Gains `view` |

`Pages/ManageCoachApplications.php` is a `ManageRecords` page, and it stays. `ManageRecords` already coexists with a view page: `UserResource.php:892-902` pairs `ManageUsers` with `ViewUser`.

### 2.3 Authorization facts

- There is **no `CoachApplicationPolicy`**, and no `Gate::policy` entry for one (`AppServiceProvider.php:144-152`).
- With no policy, Filament runs only the Gate before-callbacks, and a `null` result means **allow** (`vendor/filament/filament/src/helpers.php:60-93`).
  - `Gate::before` returns `null` for non-admins on `view`/`viewAny`.
  - So today `CoachApplicationResource::canView()` is true for members and guests too.
- Only `EnsureUserIsAdmin` stands in front, and only on page routes.
  - Livewire `/livewire/update` round trips skip it (`ViewUser.php:92-97`).
  - Only the MFA middleware is persistent (`AdminPanelProvider.php:146`).
- On mount **and** hydrate:
  - Every resource page runs `Resource::canAccess()` → `canViewAny()` (`vendor/filament/filament/src/Resources/Pages/Concerns/CanAuthorizeResourceAccess.php:7-19`).
  - `ViewRecord` adds `canView($record)` (`.../Resources/Pages/ViewRecord.php:67-86`).
- **Hidden and disabled actions are unreachable.**
  - `isDisabled()` is true when an action is hidden (`vendor/filament/actions/src/Concerns/CanBeDisabled.php:24-26`).
  - `mountAction` / `callMountedAction` refuse disabled actions (`InteractsWithActions.php:158, 244`).
  - The record is rehydrated on every round trip, so `->visible()` and `->disabled()` are re-evaluated server-side per request.

### 2.4 Panel chrome facts

- **Sidebar:**
  - It is `position: sticky` under the sticky topbar on desktop, and an off-canvas overlay below `lg`.
  - The only sidebar setting is `->sidebarCollapsibleOnDesktop()` (`AdminPanelProvider.php:102`), a deliberate `PLAN-ADMIN-DASHBOARD.md` §7 choice.
- **Active nav item:** a resource's nav item stays active on all its pages, because the active pattern is `{routeBaseName}.*` (`.../Resource/Concerns/HasNavigation.php:87-90`).
- **Page header:** breadcrumbs, heading and header actions scroll with the content; v4 has no sticky page header. Tabs keep the page short.
- **§8.3 rule:** no Tailwind utility classes in Blade, because the panel serves no compiled Tailwind (`PLAN-ADMIN-DASHBOARD.md:296-306`). This plan writes no Blade.

### 2.5 Data facts that shape the page

- **`statement`** is `VARCHAR(2000) NULL`: plain text, with meaningful newlines.
- **`decision_reason`** is `VARCHAR(1000) NULL`. It is emailed to the applicant verbatim (`CoachApplicationApproved.php:60`, `CoachApplicationRejected.php:42`).
- **No casts.** `CoachApplication` has **no `casts()`**, so `submitted_at` / `decided_at` are strings.
  - `dateTime()` runs `Carbon::parse` on strings, so this plan adds no casts.
  - Adding casts would also change the API's JSON timestamp format (`Http/Resources/CoachApplicationResource.php:33-34`).
- **Unordered documents.** `CoachApplication::documents()` has **no `ORDER BY`** (`CoachApplication.php:64-67`).
- **One row per user, for life, today.** `saveOrSubmit()` takes the user's `latest('id')` row and *resubmits* it when it is rejected (`CoachApplicationSubmissionService.php:44-62`).
  - The old documents stay attached and count toward the 2-document cap (`:145`).
  - The old documents also escape the retention purge, because `submit()` clears `decided_at` (`CoachApplication.php:81-93`).
  - `withdrawn` returns 409 there (`:72`), even though the SPA offers "Start a new application" for it (`web/src/routes/BecomeACoach.tsx:118-131`).
- **Erasure ignores coach data.** `AccountErasureService` (`app/Services/Privacy/AccountErasureService.php`) anonymizes the user but never touches `coach_applications` or `application_documents`.
  - It runs synchronously, from `AccountController::destroy` (`:32-36`) and `privacy:erase`.
  - It stamps `users.erasure_started_at` as a hard gate before step 1 (`:156-159`).
  - `EraseSelfAccount` (`DELETE /api/me`, `routes/api.php:80`) stamps the same column (`EraseSelfAccount.php:70`). That path never anonymizes the user and never runs `AccountErasureService`. The SPA doesn't call it; it uses `/api/account`.
- **`users.deleted_at`** is a 30-day-grace deletion marker, not SoftDeletes (`User.php:184-190`).
- **Document states:**

  | Stored state | Shown as | Downloadable? |
  |---|---|---|
  | `path = ''` and `original_filename = '[erased]'` (§9) | Erased | no |
  | `infected`, any path | Quarantined | no |
  | otherwise `path = ''` (retention purge, `PurgeExpiredApplicationDocumentsCommand.php:70`) | Purged | no |
  | `clean`, `path != ''` | Clean | **yes, the only case** |
  | `pending_scan`, attempts ≥ `ApplicationDocumentWork::MAX_STARTS`, no live lease | Scan failed | no |
  | `pending_scan` otherwise | Scanning | no |

- **Purged rows keep `status = 'clean'`.**
  - The download controller's `exists('')` returns true, because the disk root is a directory.
  - `download('')` then throws, which is a **500** today (`ApplicationDocumentDownloadController.php:36-37`).
  - `fileExists('')` returns false (`league/flysystem` `LocalFilesystemAdapter.php:339-351`).
- **Empty path is already handled by the scanner.** The document-work protocol never claims a row with `path = ''`, and it drops a stale result if the path changed mid-scan (`ApplicationDocumentWork.php:24-33, 172-205`). Shredding a row whose scan is in flight is therefore safe.
- **Unused transitions.** `beginReview()` (`CoachApplication.php:98`) has no callers. `withdraw()` gains its first caller in §9.
- **Same origin.** The signed download route is `routes/web.php:29-31` on `APP_URL`, the **same origin** as the panel. The modal's "media origin" copy is false. Phase 3 mitigates this.

---

## 3. Phase 0 — Make documents reachable (dev stack, prerequisite)

Without this, the new Documents tab will be as empty as the old modal.

The order of steps matters for two reasons:
- New code must not run before the migration.
- The scheduler's 5-minute `coach:recover-document-work` (`routes/console.php:57`) must not wake document #1 before its bytes are restored. That would burn an attempt and set a 5-minute wake throttle.

1. **Save the only copy of the bytes:** `docker compose cp app:/var/www/html/storage/app/application_documents <scratchpad>/appdocs-backup`.
   - `appdocs-backup` must **not** already exist. Afterwards it contains `applications/2/…`.
   - If the folder already existed, the copy nests one level deeper, and the restore below lands in the wrong place.
2. **`compose.yaml`:** add a named volume `application-documents`.
   - Mount it at `/var/www/html/storage/app/application_documents` on `app`, `queue-worker` and `scheduler`. These are the only services that touch the disk; clamd receives bytes over INSTREAM.
   - Declare it under the top-level `volumes:`.
   - `compose.e2e.yaml` is an override file and inherits the volume.
   - The production deploy symlinks `storage/` to a shared directory on one host, so it is unaffected.
3. **`Dockerfile`** (runtime stage): add `RUN mkdir -p /var/www/html/storage/app/application_documents` *before* the `chown -R www-data … storage` at line 135.
   - A fresh named volume is then seeded owned by `www-data`.
   - Without that line, the mount is root-owned and every upload fails with a 503.
   - If the volume already exists, `docker volume rm` it first.
4. Run:
   ```sh
   docker compose stop queue-worker scheduler
   docker compose build app queue-worker scheduler   # not bare build: web (tsc -b) and whisper failures would abort this
   docker compose up -d app                          # starts only app's dependencies, never queue-worker or scheduler
   docker compose exec -T app php artisan migrate
   docker compose cp <scratchpad>/appdocs-backup/. app:/var/www/html/storage/app/application_documents/
   docker compose exec -T -u root app chown -R www-data:www-data /var/www/html/storage/app/application_documents
   docker compose up -d                              # not --profile down, which tears down everything
   docker compose exec -T app php artisan coach:recover-document-work --document-id=1
   ```
5. Confirm document #1 turns `clean` in the queue-worker log and the DB. Then upload one fresh PDF end to end.

---

## 4. Phase 1 — The list

All of this is in `CoachApplicationResource.php`.

```php
protected static ?string $breadcrumb = 'Coach applications';   // vendor default is "Coach Applications"

/** One map feeds the column, the filter and the view page. */
public const STATUS_BADGES = [
    'submitted'    => ['Submitted', 'warning'],
    'under_review' => ['Under review', 'info'],
    'approved'     => ['Approved', 'success'],
    'rejected'     => ['Rejected', 'danger'],
    'withdrawn'    => ['Withdrawn', 'gray'],
];

public static function getEloquentQuery(): Builder
{
    // Q1. Not modifyQueryUsing: {record} resolves through this query, so this
    // is also what makes /coach-applications/{draft-id} a 404.
    return parent::getEloquentQuery()->where('status', '!=', 'draft');
}
```

Add `public const UNDECIDED_STATUSES = ['submitted', 'under_review'];` to `CoachApplication`. Use it in three places:
- the sort below
- the page's action visibility (§5.5)
- `ModerationQueuesWidget.php:142`, whose docblock (`:52-66`) asks for exactly this

Table:

- Replace `->modifyQueryUsing(...)` (line 80).
- Replace the three row actions with `->recordActions([ViewAction::make()->label('Review')])`.
  - Because the resource registers a `view` page, `ViewAction` renders as a **link** (`vendor/.../Resources/Pages/Page.php:382-389`).
  - The whole row also links through the default `recordUrl` (`ListRecords.php:195-206`).
  - Both go through `canView()`.
- Columns:
  - `user.username`: label Applicant, `->placeholder('—')`. The table eager-loads `user`.
  - `status`: `->badge()->formatStateUsing(fn (string $state): string => self::STATUS_BADGES[$state][0] ?? $state)->color(fn (string $state): string => self::STATUS_BADGES[$state][1] ?? 'gray')`
  - `submitted_at`: `->dateTime()->sortable()`
  - `decided_at`: label Decided, `->dateTime()->placeholder('—')->sortable()`
- Filter: `SelectFilter::make('status')->multiple()->options(array_map(fn (array $b): string => $b[0], self::STATUS_BADGES))`. No default.
- Sort: undecided first, then oldest first, as the queue was.
  ```php
  ->defaultSort(fn (Builder $query): Builder => $query
      ->orderByRaw(
          'CASE WHEN status IN ('.implode(',', array_fill(0, count(CoachApplication::UNDECIDED_STATUSES), '?')).') THEN 0 ELSE 1 END',
          CoachApplication::UNDECIDED_STATUSES,
      )
      ->orderBy('submitted_at'))
  ```
  A clicked column sort takes precedence, and this stays as the tiebreaker (`CanSortRecords.php:88-117`).
- Keep `->stackedOnMobile()`.

---

## 5. Phase 2 — The review page

### 5.1 Resource-level wiring (`CoachApplicationResource.php`)

```php
public static function form(Schema $schema): Schema
{
    return $schema->components([]);   // was the dead decision_reason field
}

public static function hasRecordTitle(): bool
{
    return true;
}

// Narrowed from string|Htmlable|null: callers concatenate it, and phpstan level 8 checks that.
public static function getRecordTitle(?Model $record): string
{
    if (! $record instanceof CoachApplication) {
        return 'Coach application';
    }

    return filled($record->user->username) ? $record->user->username : 'Application #'.$record->getKey();
}

public static function getViewAnyAuthorizationResponse(): Response   // Illuminate\Auth\Access\Response
{
    return self::adminTier();
}

public static function getViewAuthorizationResponse(Model $record): Response
{
    return self::adminTier();
}

private static function adminTier(): Response
{
    $actor = auth()->user();

    return $actor !== null && $actor->hasAnyRole(Role::ADMIN_TIER)
        ? Response::allow()
        : Response::deny('Only an administrator may view coach applications.');
}

public static function getPages(): array
{
    return [
        'index' => ManageCoachApplications::route('/'),
        'view'  => ViewCoachApplication::route('/{record}'),
    ];
}
```

- **Record title.** Override the record-title methods rather than setting `$recordTitleAttribute`. The attribute can't reach `user.username`, and it would also turn on global search.
- **The `viewAny` override** closes the allow-all on both pages, on mount and on every hydrate (§2.3). So the new page needs no `canAccess()` of its own. `ViewUser` has one only because `UserResource` doesn't override `viewAny`.
- **No new Gate ability strings**, so `$mustFallThrough` is unchanged (`PLAN-ADMIN-DASHBOARD.md` §5.7).

### 5.2 New page `CoachApplicationResource/Pages/ViewCoachApplication.php`

```php
class ViewCoachApplication extends ViewRecord
{
    protected static string $resource = CoachApplicationResource::class;

    protected static ?string $breadcrumb = 'Review';

    public function getTitle(): string
    {
        return 'Coach application: '.CoachApplicationResource::getRecordTitle($this->getRecord());
    }

    // infolist() §5.3, getHeaderActions() §5.5
}
```

On screen:
- The sidebar is unchanged, with "Coach applications" active.
- Breadcrumbs: **Coach applications › alice › Review**. The first links back to the list.
- Heading: **Coach application: alice**.
- Approve and Reject sit at the right of the heading.

### 5.3 The infolist (on the page, `ViewUser` style)

**Ordered relation.** Add to `CoachApplication`:

```php
/** @return HasMany<ApplicationDocument, $this> */
public function documentsForReview(): HasMany
{
    return $this->documents()->orderBy('id');
}
```

- **Why order by id.** The nested Download action is resolved by **list position** (`infolist.documentsForReview.{i}`). Each item's `statePath` is its position (`vendor/filament/infolists/src/Components/RepeatableEntry.php:78-83`), and the relation is re-read on every round trip.
- **The risk without it.** With no `ORDER BY`, Postgres may reorder the rows after an UPDATE (for example, a scan finishing). Download on row B could then audit and serve row A. SQLite tests would never show this.
- **Id order is stable.** Rows are never deleted, and new uploads only append higher ids.
- **Don't put `orderBy` on `documents()`.** `documents()->count()` (`CoachApplicationSubmissionService.php:145`) would then emit `count(*) … ORDER BY id`, which is a grouping error on Postgres.

**The infolist is never empty.** If it is, `ViewRecord` silently falls back to `form()` (`ViewUser.php:122-128`). Both top-level components below are unconditional.

```
Section "Application"  ->columns(3)            (above the tabs, always visible)
  Applicant        user.username ->url(UserResource::getUrl('view', ['record' => $record->user_id])) ->placeholder('—')
  Account          ->state(), first match wins: Erased (user.anonymized_at) | Erasing (user.erasure_started_at) | Deleted (user.deleted_at)
                   | Suspended (user.suspended_at) | Active, ->badge()
  Status           ->badge() + the table's two closures, but spelled CoachApplicationResource::STATUS_BADGES
                   (self:: here is the page class → undefined-constant Error on every load)
  Submitted        submitted_at ->dateTime()
  Decided          decided_at ->dateTime() ->placeholder('Undecided')
  Decided by       decidedBy.username ->placeholder('—')
  Decision reason  decision_reason, $multiline, ->columnSpanFull() ->visible(fn ($record) => $record->decided_at !== null)

Tabs ->persistTabInQueryString() ->columnSpanFull()
  Tab "Request"    ->id('request')
      statement    ->hiddenLabel(), $multiline,
                   ->placeholder(fn (CoachApplication $record): string => $record->user->anonymized_at !== null
                       ? 'Erased at the applicant’s request.' : 'No statement was submitted.')
  Tab "Documents"  ->id('documents') ->badge(fn (CoachApplication $record): int => $record->documentsForReview->count())
      RepeatableEntry::make('documentsForReview') ->hiddenLabel() ->placeholder('No documents uploaded.')
        ->table([TableColumn::make('File'), TableColumn::make('Size'), TableColumn::make('Uploaded'),
                 TableColumn::make('Status'), TableColumn::make('SHA-256'), TableColumn::make('')->hiddenHeaderLabel()])
        ->schema([ …the 6 components below… ])   // table() takes TableColumns only (ViewUser.php:385-397); 6 columns = 6 components
        original_filename
        byte_size   ->formatStateUsing(fn (int $state): string => UserResource::formatBytes($state))   // not Number::*, ext-intl is missing on the host
        created_at  ->dateTime()
        state       ->state(fn (ApplicationDocument $record): string => $record->displayState()) ->badge()
        sha256      ->fontFamily(FontFamily::Mono) ->limit(16) ->copyable() ->placeholder('—')
        Actions::make([download])            // §5.4
```

- **Write closures inline**, as above.
  - `UserResource::formatBytes(...)` fails: Filament injects closure parameters **by name** and can't resolve `$bytes`.
  - `ApplicationDocument::displayState(...)` fails: it is a static callable to an instance method.
  - Either one 500s the page, because every tab renders server-side.
- **`?tab=` persistence.**
  - Clicking a tab writes its key (`documents::tab`) to the URL, and a refresh keeps it.
  - `->id('documents')` also makes a hand-typed `?tab=documents` work.
  - Don't use `->key('documents')`. It is inheritable (`schemas/src/Components/Concerns/HasKey.php:21-26`), so it would prefix every nested key and break `schemaComponent('documentsForReview.0')`. A Tab's default key is non-inheritable (`Tab.php:61-66`).

**Multiline, escaped text.** The statement and the decision reason are user-controlled:

```php
$multiline = fn (?string $state): HtmlString => new HtmlString(nl2br(e($state ?? ''), false));
```

- `e()` is mandatory, because an `Htmlable` skips Filament's sanitizer (`CanFormatState.php:391-393`).
- **Never** use `->markdown()`, `->html()` or `->prose()` on these fields. They only sanitize, so applicant markup would render (`CanFormatState.php:394-400, 475-478`).
- `->placeholder()` still works, because the blank check reads the raw state (`TextEntry.php:190`).

**Model helpers on `ApplicationDocument`.** `isDownloadable()` is the one place the "downloadable" rule lives. The page, the action, the controller (§6) and the decision guard (§7) all use it. There is no SQL twin: an application holds at most two documents (`CoachApplicationSubmissionService::MAX_DOCUMENTS`), so loading them and checking in PHP costs nothing.

```php
use App\Services\ApplicationDocumentWork;   // new import

public const ERASED_FILENAME = '[erased]';

public function isDownloadable(): bool
{
    return $this->status === 'clean' && $this->path !== '';
}

public function displayState(): string
{
    return match (true) {
        // Both conditions: original_filename is client-supplied, so a clean
        // upload literally named "[erased]" must not read as erased.
        $this->path === '' && $this->original_filename === self::ERASED_FILENAME => 'Erased',
        $this->status === 'infected' => 'Quarantined',
        $this->path === ''           => 'Purged',
        $this->status === 'clean'    => 'Clean',
        $this->work_attempts >= ApplicationDocumentWork::MAX_STARTS
            && ! ($this->work_lease_until?->isFuture() ?? false) => 'Scan failed',
        default                      => 'Scanning',
    };
}
```

"Scan failed" mirrors `ApplicationDocumentWork::resetExhausted()` (`:138-143`). `claim()` writes `work_attempts = 3` at the *start* of the third attempt (`:227-237`). A check on attempts alone would therefore misreport a scan still in flight.

### 5.4 Opening a document: audit on click, not on render

Why the modal approach can't move onto a tab:
- **Schema tabs render every panel server-side.** A Documents tab that presigned and audited would do both on every load and every round trip, logging "viewed" for documents nobody opened. `PLAN-ADMIN-DASHBOARD.md` §5.4 hole 7 already fixed that bug once.
- **Signed URLs live 300 s** (`ApplicationDocumentUrlSigner.php:21`). A link minted at render time expires while the admin reads.

So each clean document row gets a **Download** action that does the work at click time:

```php
Action::make('download')
    ->label('Download')
    ->icon(Heroicon::OutlinedArrowDownTray)
    ->visible(fn (ApplicationDocument $record): bool => $record->isDownloadable())
    ->action(function (ApplicationDocument $record, Component $livewire): void {   // Livewire\Component
        $actor = auth()->user();
        abort_if($actor === null || ! $actor->hasAnyRole(Role::ADMIN_TIER), 403);

        if (! Storage::disk($record->disk)->fileExists($record->path)) {
            Notification::make()->danger()->title('This document is no longer available.')->send();

            return;
        }

        AuditLog::query()->create([
            'actor_id' => $actor->id,
            'action' => AuditAction::ADMIN_VIEWED_DOCUMENT,
            'subject_type' => ApplicationDocument::class,
            'subject_id' => $record->id,
            'metadata' => ['sha256' => $record->sha256, 'application_id' => $record->application_id],
            'created_at' => now(),
        ]);

        $livewire->redirect(app(ApplicationDocumentUrlSigner::class)->presign($record, 60), navigate: false);
    })
```

- **`$record` is trustworthy.**
  - It is the item at that position in this application's own `documentsForReview`, re-read server-side. Arguments are not used.
  - A row that is no longer downloadable has a hidden action, so it can't be resolved (§2.3).
  - `fileExists` covers the remaining case: a clean row whose bytes are gone.
- **What the browser does.**
  - Livewire's redirect is `window.location.href = url` (`vendor/livewire/livewire/dist/livewire.esm.js:11328-11335`).
  - The target answers `Content-Disposition: attachment`, so the PDF downloads and **the review page stays**.
  - Verify this by hand in Chrome and Safari (§11).
- **Why `navigate: false`.** `$action->redirect()` follows the panel's SPA mode (`CanRedirect.php:40`). Under `->spa()`, `Alpine.navigate` would XHR-fetch the PDF and break.
- **Why not a new tab.**
  - URL actions and server actions are mutually exclusive (`vendor/filament/actions/src/Concerns/HasAction.php:36-51`).
  - A `window.open` after the round trip loses the click's user activation, so popup blockers kill it.
- **Meaning change.** `ADMIN_VIEWED_DOCUMENT` now means "this admin was issued a 60 s download URL for these bytes". Older rows keep the old meaning; say so in the commit message.

### 5.5 Approve / Reject header actions

Both go in `getHeaderActions()` on the page. They are today's row-action closures (`CoachApplicationResource.php:184-217`), moved together with their hole-3 rationale comment (`:146-183`):

```php
$undecided = fn (CoachApplication $record): bool =>
    in_array($record->status, CoachApplication::UNDECIDED_STATUSES, true);
$hasCleanDocument = fn (CoachApplication $record): bool =>
    $record->documentsForReview->contains->isDownloadable();

Action::make('approve')
    ->color('success')
    ->requiresConfirmation()
    ->schema([Textarea::make('reason')->label('Reason (optional)')
        ->maxLength(1000)->helperText('Sent to the applicant verbatim.')])
    ->visible($undecided)
    ->disabled(fn (CoachApplication $record): bool => ! $hasCleanDocument($record))                         // Phase 4 (§7)
    ->tooltip(fn (CoachApplication $record): ?string => $hasCleanDocument($record)
        ? null : 'Approval needs at least one clean document.')                                            // Phase 4 (§7)
    ->action(function (CoachApplication $record, array $data): void {
        $actor = auth()->user();
        abort_if($actor === null, 403);

        try {
            Gate::authorize('role.assign', $record->user);
            app(CoachApplicationDecisionService::class)->approve($actor, $record, $data['reason'] ?? null);
            Notification::make()->success()
                ->title('Approved: '.CoachApplicationResource::getRecordTitle($record).' is now a coach.')->send();
        } catch (AuthorizationException|HttpException $e) {
            $record->refresh();   // a 409 means someone else decided first, or §7's guard fired
            Notification::make()->danger()->title($e->getMessage())->send();
        }
    }),
// reject: same shape, ->color('danger'), reason ->required()->maxLength(1000), ->reject(...); no disabled/tooltip
```

Changes from today:
1. **`->maxLength(1000)`.** Postgres raises a `QueryException` above 1000 characters. The catch misses it, so today that's a 500. SQLite tests don't enforce varchar length.
2. **Success notification.** Today only failures notify.
3. **`$record->refresh()` on failure**, so a stale page stops offering a decision someone else already made.
4. **Disabled Approve without a clean document** (Q3). It ships with Phase 4 (§7), together with the service guard. A disabled action is refused server-side too (§2.3).

**After a success the page stays put.**
- `CoachApplicationDecisionService` refreshes the passed model in place (`:113-117`).
- The badge therefore updates in the same response, and the `visible()` closures hide both buttons.
- Hidden actions are unreachable, so a decided application can't be re-decided through this page. The in-closure `Gate::authorize` and the service's 409 remain as defence in depth.

**`under_review` stays unused.** Calling `beginReview()` on open would be a write on a GET. It is unlocked and unaudited, it throws on a second open, and the applicant would see the status change. If you want it, make it a separate "Start review" action (§14).

---

## 6. Phase 3 — Download controller hardening

`api/app/Http/Controllers/ApplicationDocumentDownloadController.php`:

```php
abort_unless($request->hasValidSignature(), 403);
abort_unless($document->isDownloadable(), 404);                                     // was status === 'clean'
abort_unless(Storage::disk($document->disk)->fileExists($document->path), 404);     // was exists(): true for ''
// …download(), adding:
'Content-Security-Policy' => 'sandbox',
```

- This fixes the purged-row 500. Purged and erased rows become visible on the new tab, so it is no longer theoretical.
- It adds the third header `MODERNIZATION_PLAN.md:1134` requires when a PDF is served from the cookie origin.

---

## 7. Phase 4 — Approval needs a clean document (Q3)

**Enforcement.** In `CoachApplicationDecisionService::decide()`, add this right after the status `abort_unless` (`:69-73`):

```php
abort_if(
    $outcome === 'approved' && ! $locked->documents()->get()->contains->isDownloadable(),
    Response::HTTP_CONFLICT,
    "CoachApplication#{$locked->id}: cannot be approved without at least one clean document.",
);
```

`documents()->get()` loads at most two rows, and `isDownloadable()` keeps the rule in one place.

- **Placement.**
  - It runs on the freshly locked row.
  - The idempotent repeat-approve (`:65-67`) returns before it, so it is unaffected.
  - Reject is unaffected.
- **No race with uploads.** `addDocuments` locks the same application row (`CoachApplicationSubmissionService.php:96-97`), so a concurrent upload is serialized.
- **The only false refusal is benign.** A document can turn clean between the page render and the decision (the scan doesn't lock the application). The page would show Approve disabled, and a refresh fixes it.

**UI.** Add the two "Phase 4" lines in §5.5: Approve is disabled, with a tooltip, until a clean document exists.

**Tests that change.**
- `decisionFixture()` (`CoachApplicationDecisionTest.php:17-27`) becomes `decisionFixture(string $status = 'submitted', bool $withCleanDocument = true)`.
  - By default it adds one `clean` document row with a non-empty path, which keeps every existing approve test valid. This includes the self-assignment 422 test: `:137` changes only `user_id`, and the document stays attached by `application_id`.
  - Test 10 passes `false` to build the "no clean document" cases.
  - The guard reads only DB rows, so no storage is needed.
- `CoachApplicationHttpTest.php:103-121`: add a clean document row before `approve()`.

---

## 8. Phase 5 — Reapplying starts a fresh application (Q4)

In `CoachApplicationSubmissionService::saveOrSubmit()` (`:50-62`), replace the reuse branch:

```php
if ($existing === null || in_array($existing->status, ['rejected', 'withdrawn'], true)) {
    // A reapplication is a new row. The decided row keeps its decision, its
    // documents and its retention clock.
    return CoachApplication::query()->create([
        'user_id' => $applicant->id,
        'status' => 'draft',
        'statement' => $statement,
    ]);
}

if ($existing->status === 'draft') {
    $existing->submit($statement);

    return $existing;
}
```

In `CoachApplication::submit()` (`:81-93`), change it to `assertStatus('draft')` only. Drop the `decided_*` / `decision_reason` resets, which a draft never has. Update the method's docblock and the class docblock (`:18-20`).

**Why it is safe**
- The partial unique index `uq_coach_app_live(user_id) WHERE status IN (draft, submitted, under_review)` admits the new draft, because rejected and withdrawn rows aren't live.
- The user-row lock (`:42`) serializes concurrent POSTs.
- `me()` returns `latest('id')` (`CoachApplicationController.php:58-69`), so the SPA's "Start a new application" button (`BecomeACoach.tsx:57-61`) now gets a **draft** back.
  - It renders the form with the old statement prefilled and no documents.
  - The applicant uploads fresh PDFs and submits.
  - **No SPA change is needed.**

**What it fixes**
- The 2-document cap is per attempt.
- Old documents keep their `decided_at` / `documents_purge_after`, so the retention purge deletes them on schedule.
- The old decision record survives on its own row, so the admin list shows the history.
- The review page shows only the current attempt's documents.
- `withdrawn` no longer returns 409, which matches what the SPA already offers.

**Contract and data**
- This deliberately reverses STEP-12's "`rejected -> draft` legal, reusing the row" (quoted at `CoachApplication.php:77-79`). Record that in the commit message.
- The migration docblock's "history accumulates" (`2026_08_22_100001_…:29`) becomes true. Leave the migration file as it is.
- Rows that were already reused under the old behaviour keep their mixed documents. No backfill is possible, because the attempt boundary was never recorded. The dev DB has none.

**Tests.** Rewrite `CoachApplicationHttpTest.php:144` ("reuses the same row") as "reapplying creates a new draft row". It asserts:
- the old row is still `rejected`, with its `decided_at`, `decision_reason` and `documents_purge_after` intact;
- the new row is `draft` with 0 documents;
- `me` returns the new row;
- two new uploads succeed even when the old row already holds two;
- submitting the new draft makes it `submitted`.

Also rewrite `CoachApplicationAdmissionTest.php:221-222`. It sets the latest row to `withdrawn` and expects the POST to return 409. It should now expect 201, with status `draft` and an id different from the withdrawn row's. That single rewrite is the `withdrawn` coverage.

The SPA needs no change. Its vitest already mocks "Start a new application" returning a draft (`web/src/routes/BecomeACoach.test.tsx:101-147`). The form uploads to `application.id` (`CoachApplicationForm.tsx:122-125`).

---

## 9. Phase 6 — Erasure shreds coach applications (Q2)

**New `App\Services\Privacy\CoachApplicationErasure`:**

```php
class CoachApplicationErasure
{
    public function __construct(private readonly StorageObjectRemover $remover) {}

    /** @return array{count: int, bytes: int} */
    public function plan(User $user): array
    {
        $documents = ApplicationDocument::query()
            ->whereIn('application_id', CoachApplication::query()->where('user_id', $user->id)->select('id'))
            ->where('path', '!=', '')
            ->get(['byte_size']);

        return ['count' => $documents->count(), 'bytes' => (int) $documents->sum('byte_size')];
    }

    /** @return array{count: int, bytes: int} */
    public function execute(User $user): array
    {
        $documents = DB::transaction(function () use ($user) {
            // Same lock order as CoachApplicationSubmissionService: user -> application.
            User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $applications = CoachApplication::query()->where('user_id', $user->id)->lockForUpdate()->get();

            foreach ($applications as $application) {
                if (in_array($application->status, ['draft', 'submitted', 'under_review'], true)) {
                    $application->withdraw();   // leaves the admin queue; the decision service 409s on withdrawn
                }
                $application->forceFill(['statement' => null])->save();
            }

            return ApplicationDocument::query()
                ->whereIn('application_id', $applications->modelKeys())
                ->where('path', '!=', '')
                ->get(['id', 'disk', 'path', 'byte_size']);
        });

        $bytes = 0;
        foreach ($documents as $document) {
            // Throws if a delete fails, so a row is never blanked while bytes remain (step 2's rule).
            $this->remover->deleteExisting($document->disk, [$document->path], "Account-erasure coach-document purge failed for document {$document->id}.");
            ApplicationDocument::query()->whereKey($document->id)->where('path', $document->path)
                ->update(['path' => '', 'original_filename' => ApplicationDocument::ERASED_FILENAME]);
            $bytes += (int) $document->byte_size;
        }

        return ['count' => $documents->count(), 'bytes' => $bytes];
    }
}
```

**What is kept.**
- The application rows, with their status, decision and `decision_reason`.
- The document rows, with `sha256` and `status`.
- This matches STEP-12's retention rule: "keeping only the decision record and hashes". That rule is the same one the purge command follows (`PurgeExpiredApplicationDocumentsCommand.php:63-70`).

**Wire it into `AccountErasureService`** as **step 6c**, between 6b and 7:
- Inject `CoachApplicationErasure` through the constructor.
- `plan()` gains `['key' => 'coach_applications_shredded', 'label' => '6c. Shred coach-application statements and documents', 'count' => …, 'bytes' => …]` in that position.
- `execute()` calls it after the connections delete and records its counts in the same position.
- Update the class docblock's step list. Update `STEP-11-FROZEN-CONTRACT.md` §6 to record the deliberate extension.

**Close the erasure race in `CoachApplicationSubmissionService`.**
- In both `saveOrSubmit` (`:42`) and `addDocuments` (`:96`), keep the locked user row: `$lockedUser = User::query()->…->lockForUpdate()->firstOrFail();`.
- Then add `abort_if($lockedUser->erasure_started_at !== null, Response::HTTP_CONFLICT, 'This account is being erased.');`.
- Erasure stamps `erasure_started_at` under the same user lock before step 1 (`AccountErasureService.php:156-159`). So every submission either commits before the stamp, and step 6c sees it, or is refused.
- `addDocuments` already compensates staged bytes when its transaction throws (`:132-135`).
- `ReviewService::invite` and `VoiceNoteService::create` already 409 on the same gate.
- **`DELETE /api/me` is the one side effect.** `EraseSelfAccount` stamps this column without anonymizing (§2.5). So that account is refused new coach applications from then on, exactly as `ReviewService::invite` already refuses it. Its coach data is **not** shredded; only `DELETE /api/account` and `privacy:erase` shred. An application they had already submitted can then only be rejected: Approve returns 409 "The applicant is erasing their account." The §5.3 Account badge reads **Erasing**, so that refusal doesn't surprise the admin.
- Fix the `User.php:166-171` comment, which says `erasure_started_at` "only ever gates the narrower reviewer-voice-note erasure slice".

**Close the matching race on the decision side.** In `CoachApplicationDecisionService::decide()`, next to §7's guard, add:

```php
abort_if(
    $outcome === 'approved' && $applicant->erasure_started_at !== null,
    Response::HTTP_CONFLICT,
    'The applicant is erasing their account.',
);
```

`$applicant` is the user row the service already locks at `:60`. Without this, an admin could approve in the gap between the erasure stamp and step 6c, leaving an anonymized account that holds the coach role.

**Backfill for accounts erased before this ships.**
- Run it once in dev, and once after the deploy that lands this.
- It is idempotent and prints the number of documents it shredded, so a second run prints `0`.
- It is a no-op for users with no applications.
- The dev DB currently has no anonymized users.

```sh
docker compose exec -T app php artisan tinker --execute='echo App\Models\User::query()->whereNotNull("anonymized_at")->lazyById()->sum(fn ($u) => app(App\Services\Privacy\CoachApplicationErasure::class)->execute($u)["count"]), PHP_EOL;'
```

(`tinker --execute` discards the return value, hence the `echo`.)

**On the review page,** an erased applicant shows:
- an **Erased** account badge;
- "Erased at the applicant's request." in place of the statement;
- documents marked **Erased**;
- no Approve or Reject, because a live application was withdrawn.

**Scope.** This covers self-erasure only: "when they ask to be deleted". An admin-initiated deletion (`users.deleted_at`, `UserDeletionService`) is a separate, reversible 30-day soft-delete that doesn't run `AccountErasureService`, so it doesn't shred (§14).

---

## 10. Removals, comment fixes, and what breaks

**Remove**

- The `viewDocuments` action (`CoachApplicationResource.php:94-145`) and its unused imports.
- `api/resources/views/filament/coach-application-documents.blade.php`.

**Comment and doc fixes** (also grep for `viewDocuments`, `coach-application-documents` and `media origin`):

- `CoachApplicationResource.php:25-35`: the class docblock. It should describe a list plus a review page, with per-click downloads.
- `ManageCoachApplications.php:8-12`: "no separate view/edit route".
- `ModerationQueuesWidget.php:52-66`: a stale line cite; it now uses the constant.
- `ViewUser.php:353-356`: says `ADMIN_VIEWED_DOCUMENT`'s subject is User. It is ApplicationDocument.
- References in `UserResource.php:60-71`, `SpeechResource.php:564, 600, 775` and `ReportResource.php:36`.
- Docblock pointers to `PanelModerationTest::renderPanelTablesWithoutIntl()` in `ReportSurfaceTest.php:49` and `UserSurfaceTest.php:83`. They now point to `PanelHelpers.php`; these are comments only.
- **§8, reapply:**
  - `CoachApplication.php:18-20, 76-80`
  - `CoachApplicationController.php:31-41` (reuses the rejected row; withdrawn is a 409)
  - `CoachApplicationSubmissionService.php:33-36`
  - optionally, the comment-only `web/src/features/coachApplication/types.ts:14-17`
  - The migration docblock `2026_08_22_100001_…:16-18` is deliberately left as is.
- **§9, erasure:**
  - `AccountErasureService.php:22-44`
  - `ErasurePlan.php:12-15` ("exactly the 8 steps")
  - `PrivacyEraseCommand.php:14-15`
  - the `PrivacyEraseCommandTest.php:7-17` docblock
  - `User.php:166-171`
  - `STEP-11-FROZEN-CONTRACT.md` §6

**Pest tests that break**

| File | Test / line | Why | Commit | Becomes |
|---|---|---|---|---|
| `PanelModerationTest.php` | hole 3: approve, 488 | row action on the list; the member probe mounts the list, which now 403s | C | §11 test 6 (with a clean document) |
| `PanelModerationTest.php` | hole 3: reject, 511 | same | C | §11 test 6 |
| `PanelModerationTest.php` | hole 7 second instance, 535 | the modal is removed; its core assertion is deliberately reversed | C | §11 test 5 |
| `PanelModerationTest.php` | §8.3 blades, 820 | it renders the removed blade | C | drop that blade's case |
| `CoachApplicationDecisionTest.php` | every approve test, through `decisionFixture()` :17-27 | no clean document | D | the fixture adds one |
| `CoachApplicationHttpTest.php` | coach approval reaches the directory, 103 | no clean document | D | add one before `approve()` |
| `CoachApplicationHttpTest.php` | reapplies by reusing the same row, 144 | behaviour deliberately reversed | E | §8's rewrite |
| `CoachApplicationAdmissionTest.php` | creation locks the applicant first…, 212 (`:221-222`) | a withdrawn POST now creates a new draft (it was a 409) | E | assert 201, status `draft`, id ≠ the withdrawn row's |

**Not affected:**
- `DashboardPageTest`.
- `AccountErasureServiceTest`: existing assertions read steps by key (`:209`).
- `PrivacyEraseCommandTest`: `expectsOutputToContain('6b…')` still matches.
- Every Playwright spec.
- The SPA, which needs no logic change (§8).

---

## 11. Tests to add

**Setup**
- **Move the helpers.** Move `renderPanelTablesWithoutIntl()` and the `panel*` helpers (`PanelModerationTest.php:117-191`) into `api/tests/Feature/Admin/PanelHelpers.php`.
  - Add `use App\Filament\Resources\UserResource\Pages\ManageUsers;` and `use Filament\Tables\Table;` there.
  - `require_once` it from both files (pattern: `ApplicationDocumentWorkTest.php:11`).
  - They are global functions. A copy causes "Cannot redeclare", and leaving them where they are causes "undefined function" when the new file runs alone.
  - `captureHttpStatus` (`:201`) stays.
- **Clean up imports.** Delete the now-unused `use` lines for `ManageCoachApplications`, `ApplicationDocument` and `CoachApplication` from `PanelModerationTest.php`. CI runs `pint --test` with the `laravel` preset (`.github/workflows/ci.yml:81`), and its `no_unused_imports` rule would fail.
- **New test files.**
  - Tests 1-6, 9, and test 11's erased-applicant page case: `api/tests/Feature/Admin/CoachApplicationReviewPageTest.php`.
  - Test 7: `api/tests/Feature/CoachApplication/ApplicationDocumentDisplayStateTest.php` (`require_once __DIR__.'/DocumentWorkHelpers.php';`).
  - Test 10: `CoachApplicationDecisionTest`.
  - Test 11, the rest:
    - `CoachApplicationHttpTest` and `CoachApplicationAdmissionTest` (reapply)
    - `AccountErasureServiceTest` (shred)
    - `CoachApplicationHttpTest` (submission gate)
    - `CoachApplicationDecisionTest` (decision gate)
    - `PrivacyEraseCommandTest` (the 6c output)
- **Shared setup.**
  - Use `Storage::fake('application_documents')` throughout.
  - The list test calls `renderPanelTablesWithoutIntl()` (no ext-intl on the host).

**Tests**

1. **Access.**
   - `CoachApplicationResource::canViewAny()` / `canView($app)` are false for member, coach and guest, and true for admin and super_admin.
   - Mounting either page as a member returns 403.
2. **List.**
   - Shows submitted, approved and rejected; hides draft.
   - The only record action is `view`, and the row URL points to the view page.
   - The multi-status filter narrows the list; undecided rows sort first.
   - Two attempts by one applicant show as two rows.
3. **Draft id is a 404** on the view route.
4. **Rendering.**
   - `assertSchemaComponentStateSet('statement', …)`.
   - `assertSeeHtml("line one<br>\nline two")`.
   - With a `<script>alert(1)</script>` statement: `assertSeeHtml('&lt;script&gt;alert(1)')` and `assertDontSeeHtml('<script>alert(1)')`.
   - A null statement shows the placeholder.
5. **Download.** Address the action as `TestAction::make('download')->schemaComponent('documentsForReview.0')`.
   - Opening the page writes zero `ADMIN_VIEWED_DOCUMENT` rows and leaves the status `submitted`.
   - A click writes exactly one audit row (right `subject_id`, `sha256` and `application_id`) and redirects to a URL that passes `URL::hasValidSignature()` (read it from `->effects['redirect']`).
   - With two documents, position 1 audits position 1's id.
   - A clean row with a missing file: no audit row, `assertNoRedirect()`, a danger notification.
   - Pending, infected, purged and erased rows: `mountAction(...)` is a no-op.
6. **Approve / Reject.** Every approve case attaches a clean document.
   - On success: status, coach role (approve), one decision audit row, a success notification, and both actions hidden afterwards.
   - Reject without a reason fails `required`; a 1001-character reason fails `max`.
   - A decided record hides both actions, and `mountAction('approve')` is a no-op.
   - **Gate probe.** Register a test `Gate::before(fn ($u, $a) => $a === 'role.assign' ? false : null)` and mock `CoachApplicationDecisionService` with `shouldNotReceive('approve')`. Expect a danger notification. The service re-authorizes internally (`:63`), so the mock is what proves the check happens in the closure.
7. **`displayState()`**, using `workDocument()`: every row of the §2.5 table.
   - "Third attempt in flight" (live lease) → Scanning.
   - `path = ''` with `[erased]` → Erased.
   - A clean upload literally named `[erased]` → Clean.
8. **Download controller** (new `ApplicationDocumentDownloadControllerTest`).
   - Unsigned, tampered or expired URL → 403.
   - Pending, infected or purged document → 404 (purged was a 500).
   - Clean → 200, with `attachment`, `nosniff`, `application/pdf` and `CSP: sandbox`.
9. **Clean-document guard on the page.**
   - With no document, or only pending, infected or purged ones, `assertActionDisabled('approve')`, and `mountAction('approve')` is a no-op.
   - With one clean document, Approve is enabled.
   - Reject is enabled either way.
10. **Clean-document guard in the service** (`CoachApplicationDecisionTest`).
    - Approve with no document (`decisionFixture(withCleanDocument: false)`), or with only non-clean ones → 409, with no status change, no role, and no audit row.
    - Approve with a clean document → approved.
    - Reject with no documents still works.
11. **Reapply and erasure.**
    - §8's rewrite of `CoachApplicationHttpTest:144`, and the `withdrawn` case through the `CoachApplicationAdmissionTest:221-222` rewrite.
    - **Erasure** (`AccountErasureServiceTest`). Set up a submitted application with a clean document's bytes on the fake disk, plus an earlier rejected application with a document. After `execute()`:
      - the bytes are gone;
      - both document rows have `path = ''`, `original_filename = '[erased]'`, and keep their `sha256`;
      - both statements are null;
      - the submitted application is `withdrawn`;
      - the rejected one keeps its status and decision;
      - `plan()->step('coach_applications_shredded')` taken before the run equals the count `execute()` reports;
      - a second `CoachApplicationErasure::execute()` returns `count: 0`.
    - **Erasure gate.** With `erasure_started_at` set:
      - POST `/api/coach-applications` returns 409;
      - an upload returns 409 and leaves no staged object on the fake disk;
      - `CoachApplicationDecisionService::approve()` returns 409 with the role unchanged, while reject still works.
    - **Review page for an erased applicant:** Erased badge, the statement placeholder, documents marked Erased, no Approve or Reject.
    - **Erasing state.** With `erasure_started_at` set but not anonymized, the Account badge reads Erasing.
    - **`PrivacyEraseCommandTest`:** the output contains `6c. Shred coach-application`.

**Manual check.** Do this after Phase 0, against the rebuilt stack. `api/` is baked into the image, so rebuild before looking.
- The list shows application #2 as Submitted. A row click opens the review page, with the sidebar and breadcrumbs as in §5.2.
- The Documents tab survives a refresh, and `?tab=documents` opens it directly.
- Approve is disabled until document #1 is clean, and its tooltip says why.
- Download in Chrome **and** Safari: the file downloads, the page stays, and exactly one audit row is written.
- Approve: the badge turns Approved, the buttons go, the applicant's email appears in Mailpit, and the SPA shows "You're a coach".
- **Reapply:**
  1. Reject a second test applicant.
  2. In the SPA, as that applicant, click "Start a new application": the form opens with no documents.
  3. Upload and submit.
  4. The panel list shows two rows for them.

Run Pest and phpstan with the memory flag (the host php.ini limit is 128M).

---

## 12. Sequencing

| Commit | Work | Green when |
|---|---|---|
| A | Phase 0: `compose.yaml` volume + `Dockerfile` mkdir (§3), then the §3 steps | document #1 is `clean`; a fresh upload scans clean |
| B | Model helpers (`documentsForReview`, `isDownloadable`, `displayState`, `ERASED_FILENAME`, `UNDECIDED_STATUSES`) + controller hardening (§6) + tests 7, 8 | those tests + phpstan + `pint --test` |
| C | List, auth overrides, `getPages`, `ViewCoachApplication` (infolist, download, header actions *without* the Phase 4 lines), modal and blade removal, widget constant, comment fixes, helper move + unused-import cleanup, migrated tests + tests 1-6 | full Pest + phpstan + `pint --test` |
| D | Phase 4 (§7): service guard, the two disabled/tooltip lines, fixture updates + tests 9, 10 | full Pest + phpstan + pint |
| E | Phase 5 (§8): new-row reapply, `submit()` tightening, docblocks, the `HttpTest:144` and `AdmissionTest:221-222` rewrites | full Pest + phpstan + pint |
| F | Phase 6 (§9): `CoachApplicationErasure`, step 6c, the erasure gate in submission and decision, the STEP-11 doc, comment fixes + erasure tests; then run the backfill | full Pest + phpstan + pint; the backfill prints `0` on a second run |
| — | Manual check (§11) | — |

- **C is one commit on purpose.** The list loses its actions in the same change that gives the page its actions, and `getPages` needs the page class to exist.
- **Order dependencies.** D, E and F each stand alone once C is in. D edits C's Approve action. F's page behaviour relies on B's `ERASED_FILENAME`.

---

## 13. Decisions (resolved 2026-10-28)

| | Question | Decision | Effect |
|---|---|---|---|
| Q1 | Drafts in the admin list? | **No** | `getEloquentQuery()` excludes them; the detail route 404s for them (§4) |
| Q2 | Erased applicants' coach data? | **Shred it when they ask to be deleted** | Erasure step 6c, the submission and decision gates, and a backfill (§9) |
| Q3 | Approving with no clean document? | **Block** | Service guard and a disabled Approve (§7) |
| Q4 | Reapplying reuses the old row and documents? | **Fix it now** | New draft row per attempt (§8) |

---

## 14. Deliberately not doing

- **Sidebar changes.** It is already sticky. `->spa()` or removing the collapse button would be panel-wide and break `admin-panel.spec.ts:143-261`.
- **A `CoachApplicationPolicy`.** The convention for panel resources is explicit resource overrides (`UserResource`).
- **`under_review` / "Start review".** This needs a locked, audited service method and a new `AuditAction`.
- **A "previous applications" panel** on the review page. After §8, the list shows each attempt as a row, which is enough for now.
- **Shredding on admin-initiated deletion** (`users.deleted_at`). That is a reversible 30-day soft-delete, not the applicant asking to be forgotten.
- **Merging the shred and purge code.** `CoachApplicationErasure` and `PurgeExpiredApplicationDocumentsCommand` blank rows the same way, but the purge has no tests today. Merging them is a follow-up, done together with its first tests.
- **A cookieless download host.** It is the real fix for same-origin PDFs. `CSP: sandbox` is the interim control the plan of record names.
- **Inline PDF preview.** It is prohibited by `MODERNIZATION_PLAN.md:1134-1135`.
- **Model `casts()`.** Not needed, and adding them would change the API JSON.
- **Factories.** The shared `panel*`, `decisionFixture` and `workDocument` helpers are enough.
- **A backfill for rows reused before §8.** The attempt boundary was never recorded.

---

## 15. Corrections by revision

### Implementation review (2026-10-29), applied to the code

The adversarial review of the implemented diff found no blocker or major issue. Two §9 gaps were fixed in `CoachApplicationErasure`:

- **Drafts are no longer withdrawn.** Only `UNDECIDED_STATUSES` rows are withdrawn. A withdrawn draft would have appeared in the admin list, which hides only drafts (Q1).
- **Leftover client filenames are erased.** Rows whose bytes were already gone (infected-cleanup, or the scanner racing step 6c) kept the client-supplied filename. A final update now renames them to `[erased]`.
- `count` / `bytes` include only rows that step 6c actually blanked.
- A new `AccountErasureServiceTest` case covers both fixes.

Nits:
- the submission-gate comment now covers `DELETE /api/me`;
- the dead `panelSubmittedApplication` / `panelCleanDocument` helpers were removed.

### Final validation of rev 5 (verdict: valid with fixes, all applied)

The validator confirmed in source that all ten rev-5 fixes and both simplifications landed and introduced no error:
- `users.erasure_started_at` exists and is cast to `datetime`.
- The decision guard runs after the Gate, the idempotent return and the status abort.
- The backfill quoting and `LazyCollection::sum(closure)` work (probed read-only).
- `decisionFixture`'s new signature fits every call site, including the dataset test.
- Larastan types `contains->isDownloadable()` as bool.

It left three wording nits and one optional UX note, all now applied:
- §11 test 11 now points the `withdrawn` case at `CoachApplicationAdmissionTest`.
- A duplicate preamble bullet was removed.
- §9 states that an already-submitted application of a `DELETE /api/me` user can only be rejected.
- The Account badge gains an **Erasing** state (§5.3).

### rev 5: what validating rev 4 found (verdict: valid with fixes)

Only #1 would have broken CI. Nothing would fatal, 500 or open a hole. The validation confirmed these in source:
- §7's guard placement, including the self-assignment 422 test still reaching `assign()`.
- That every `->approve(` caller is covered.
- That a disabled action still renders its tooltip (`CanGenerateButtonHtml.php:102, 197-203`), and that `assertActionDisabled` exists (`TestsActions.php:258`).
- §8's SPA claim: the vitest already mocks a draft restart, and nothing else assumes one row per user.
- §9's step position, its lock order (no deadlock) and its selected columns; that no outer transaction wraps erasure; and that no API tokens exist.

| # | Severity | rev 4 said | Fixed to |
|---|---|---|---|
| 1 | MAJOR | `CoachApplicationAdmissionTest` "not affected" | `:221-222` POSTs against a withdrawn application and expects 409. Rewritten in commit E (§8, §10, §0). |
| 2 | MINOR | `scopeDownloadable(Builder $query): Builder` | **Removed** (simplification). Bare `Builder` fails phpstan level 8 generics, and with at most 2 documents per application, `documents()->get()->contains->isDownloadable()` keeps a single PHP rule (§5.3, §7). |
| 3 | MINOR | The erasure gate as a pure win | `DELETE /api/me` stamps the same column without erasing. Documented, plus the `User.php` comment fix (§2.5, §9). |
| 4 | MINOR | The backfill "reports 0" | `tinker --execute` discards return values, so the one-liner now echoes the count (§9). |
| 5 | MINOR | Comment-fix list | Adds the controller, submission service, `ErasurePlan`, `PrivacyEraseCommand` (+ test docblock), `User.php` and SPA `types.ts` (§10). |
| 6 | NIT | "Erased" keyed on `original_filename` alone | Also requires `path = ''`; the filename is client-supplied (§5.3, test 7). |
| 7 | NIT | `decisionFixture()` always adds a clean document | `withCleanDocument` parameter for the 409 cases (§7, test 10). |
| 8 | NIT | Erasure race on the decision side (optional) | **Adopted**: approve 409s once `erasure_started_at` is set (§9, test 11). |
| 9 | NIT | "Tests 10-11: the existing files" | File placement spelled out (§11). |
| 10 | NIT | Commit B gated on its tests only | + phpstan + pint, so model-code issues surface at B (§12). |

### rev 4: your decisions

- **Q1:** confirmed; no change.
- **Q2:** Phase 6 (§9) added: the `CoachApplicationErasure` service, erasure step 6c, the `erasure_started_at` gate in submission, a backfill, an "Erased" document state and a statement placeholder.
- **Q3:** Phase 4 (§7) added: the decision-service guard, a disabled Approve with a tooltip, and the fixture updates. This replaces rev 3's "warn in the confirmation modal". (Rev 4 also had a `scopeDownloadable` twin, which rev 5 removed.)
- **Q4:** Phase 5 (§8) added: a new draft row on reapply (also for `withdrawn`), `submit()` restricted to drafts, and a test rewrite. This replaces rev 3's "out of scope".
- §10, §11 and §12 were extended to match. §13 records the decisions.

### rev 3: what the final validation found (verdict: valid with fixes)

The validation found nothing that would fatal, 500, or open a security hole as written. The fixes close gaps where the obvious way to fill them would break CI or the page. All 17 rev-2 corrections were confirmed in the vendor source.

| # | Severity | rev 2 said | Fixed to |
|---|---|---|---|
| 1 | MINOR | Helpers moved; tests moved or deleted | Also delete 3 now-unused imports: `pint --test` (`no_unused_imports`) fails CI otherwise. Pint added to the commit gates. |
| 2 | MINOR | Move helpers `:128-191` | `:117-191`, so `renderPanelTablesWithoutIntl()` comes along; otherwise "redeclare" or "undefined". |
| 3 | MINOR | Status entry: "same closures as the table" | Spelled `CoachApplicationResource::STATUS_BADGES`; `self::` on the page is an undefined constant. |
| 4 | NIT | Backup with `docker compose cp` | The target folder must not pre-exist, or the copy nests. |
| 5 | NIT | `->key()` "collides with the RepeatableEntry" | An inheritable key that breaks the nested action's addressing. |
| 6 | NIT | `->table([File, …])`, with the entries implied | `TableColumn::make(...)` in `table()`, the entries in `schema()`. |
| 7 | NIT | Test 7 had no file | `ApplicationDocumentDisplayStateTest.php`, shipped in commit B. |
| 8 | NIT | Bare `docker compose build` | `build app queue-worker scheduler`. |

The rev 3 re-validation was checked against source:
- `key()` defaults to inheritable, and Tab keys don't.
- `TableColumn::make()` and `hiddenHeaderLabel()` exist.
- The `require_once` pattern exists.
- The three imports to delete are used only inside the moved or deleted ranges.
- `ManageUsers` and `Table` stay used in `PanelModerationTest.php`, so they are copied, not moved.
- The surface tests mention the helper only in docblocks.

### rev 2: what the adversarial review found

| # | Severity | rev 1 said | Fixed to |
|---|---|---|---|
| 1 | BLOCKER | `formatStateUsing(UserResource::formatBytes(...))`, `->state(ApplicationDocument::displayState(...))` | Inline closures. By-name injection can't resolve `$bytes`, and the second is a static callable to an instance method. Either one 500s the page. |
| 2 | MAJOR | `RepeatableEntry::make('documents')` | `documentsForReview()` ordered by id. The nested action resolves by position over an unordered relation. |
| 3 | MAJOR | "`->visible()` is cosmetic" | Hidden actions are unreachable. The tests assert no-ops, and the Gate probe mocks the service. |
| 4 | MINOR | One commit per sequencing row | The page, list and test migrations land in one commit. |
| 5 | MINOR | Phase 0 ran `up -d`, then migrate, then restore | Workers stopped first, migrate before they start, root `chown`, `cp …/.`. |
| 6 | MINOR | "Clicking a header replaces the default sort"; muddled bindings | The default stays as a tiebreaker; `orderByRaw` uses bindings. |
| 7 | MINOR | "Scan failed" when attempts ≥ 3 | Plus "no live lease", mirroring `resetExhausted()`. |
| 8 | MINOR | A `string\|Htmlable\|null` title concatenated; `$record?->user` on `?Model` | A narrowed `getRecordTitle(): string` with an `instanceof` check. |
| 9 | MINOR | "Move the helpers if both files need them" | Moved to `PanelHelpers.php` + `require_once`. |
| 10 | MINOR | `line one<br>line two`; "never `<script>`" | `<br>\n`; assert on the specific payload. |
| 11 | MINOR | Account: Erased / Suspended / Active | Adds Deleted. |
| 12 | MINOR | Comment-fix list; §0's test count | Adds the class docblock and the hole-3 rationale move; count corrected. |
| 13 | NIT | `ViewCoachApplication::canAccess()` | Dropped: the resource's `viewAny` override covers mount and hydrate. |
| 14 | NIT | "`?tab=documents` survives refresh" | The URL carries the tab key; `->id()` also accepts the short form. |
| 15 | NIT | The download re-read the document "for safety" | Dropped; `fileExists` kept. |
| 16 | NIT | Audit means "fetched these bytes"; "drop all recordActions" | "Was issued a 60 s URL"; "replace with `ViewAction`". |
| 17 | NIT | `$this->redirect($url)`; a count query for the badge | `$livewire->redirect($url, navigate: false)`; the badge reuses the loaded relation. |
