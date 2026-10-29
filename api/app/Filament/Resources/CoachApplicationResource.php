<?php

namespace App\Filament\Resources;

use App\Filament\Resources\CoachApplicationResource\Pages\ManageCoachApplications;
use App\Filament\Resources\CoachApplicationResource\Pages\ViewCoachApplication;
use App\Models\CoachApplication;
use App\Support\Role;
use Filament\Actions\ViewAction;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Auth\Access\Response;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * STEP-12-admin-portal.md demo steps 3-5, reshaped by
 * PLAN-COACH-APPLICATION-REVIEW-PAGE.md: a list of every non-draft
 * application with its status, and a review page per application
 * (`Pages\ViewCoachApplication`) holding the statement, the documents and
 * the Approve / Reject decision.
 *
 * ⚠️ A document is NEVER rendered inline on the panel — only metadata and
 * hash. Each clean document has a Download action that, at click time,
 * audits the read and redirects to a 60 s
 * `App\Services\ApplicationDocumentUrlSigner` URL; the controller behind it
 * (`App\Http\Controllers\ApplicationDocumentDownloadController`) forces
 * `Content-Disposition: attachment`. That is the non-negotiable this
 * resource exists to honor.
 */
class CoachApplicationResource extends Resource
{
    protected static ?string $model = CoachApplication::class;

    /**
     * PLAN-ADMIN-DASHBOARD.md §7. Five flat, icon-less, arbitrarily
     * ordered nav items was the shipped state — no resource set a group,
     * an icon or a sort. Grouping matters more than it looks: the panel's
     * landing page is now a dashboard (§6.1), so the sidebar is the only
     * wayfinding an admin has, and "Moderation" (what needs attention
     * today) versus "People" (who the platform is made of) is the split
     * an actual moderation session follows.
     */
    protected static \UnitEnum|string|null $navigationGroup = 'People';

    protected static \BackedEnum|string|null $navigationIcon = 'heroicon-o-academic-cap';

    protected static ?int $navigationSort = 1;

    protected static ?string $navigationLabel = 'Coach applications';

    /** The vendor default would be "Coach Applications". */
    protected static ?string $breadcrumb = 'Coach applications';

    /**
     * Label and colour per status. One map feeds the list column, the
     * status filter and the review page's badge (§4).
     *
     * @var array<string, array{0: string, 1: string}>
     */
    public const STATUS_BADGES = [
        'submitted' => ['Submitted', 'warning'],
        'under_review' => ['Under review', 'info'],
        'approved' => ['Approved', 'success'],
        'rejected' => ['Rejected', 'danger'],
        'withdrawn' => ['Withdrawn', 'gray'],
    ];

    /**
     * Q1: drafts never reach the panel. Here rather than in the table's
     * `modifyQueryUsing()`, because `{record}` on the review page resolves
     * through this query too — this is also what makes
     * `/coach-applications/{draft-id}` a 404.
     */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->where('status', '!=', 'draft');
    }

    /** Was a dead `decision_reason` field; the decision is a page action. */
    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    public static function table(Table $table): Table
    {
        return $table
        // PLAN-ADMIN-DASHBOARD.md §7. Filament tables already scroll
        // horizontally when they overflow, but `filament/tables`'
        // own layout doc is explicit that this is NOT sufficient: "on
        // mobile, the user is unable to see much information in a table
        // row at once without scrolling". `stackedOnMobile()` turns each
        // row into a labelled card below the `sm` breakpoint and adds a
        // sort dropdown, which is the difference between a moderator
        // being able to triage on a phone and not.
        //
        // Applied to all five resources identically rather than per
        // table, because the one thing worse than an unreadable mobile
        // table is four readable ones and a fifth nobody noticed.
            ->stackedOnMobile()
            // Still reads as a queue: undecided first, then oldest
            // submission first. A clicked column sort takes precedence and
            // this stays as the tiebreaker (`CanSortRecords.php:88-117`).
            ->defaultSort(fn (Builder $query): Builder => $query
                ->orderByRaw(
                    'CASE WHEN status IN ('.implode(',', array_fill(0, count(CoachApplication::UNDECIDED_STATUSES), '?')).') THEN 0 ELSE 1 END',
                    CoachApplication::UNDECIDED_STATUSES,
                )
                ->orderBy('submitted_at'))
            ->columns([
                TextColumn::make('user.username')->label('Applicant')->placeholder('—'),
                TextColumn::make('status')
                    ->badge()
                    ->formatStateUsing(fn (string $state): string => self::STATUS_BADGES[$state][0] ?? $state)
                    ->color(fn (string $state): string => self::STATUS_BADGES[$state][1] ?? 'gray'),
                TextColumn::make('submitted_at')->label('Submitted')->dateTime()->sortable(),
                TextColumn::make('decided_at')->label('Decided')->dateTime()->placeholder('—')->sortable(),
            ])
            ->filters([
                SelectFilter::make('status')
                    ->multiple()
                    ->options(array_map(fn (array $badge): string => $badge[0], self::STATUS_BADGES)),
            ])
            // The decision lives on the review page (§5.5). With a `view`
            // page registered, `ViewAction` renders as a link, and the
            // whole row links there too; both go through `canView()`.
            ->recordActions([
                ViewAction::make()->label('Review'),
            ]);
    }

    public static function hasRecordTitle(): bool
    {
        return true;
    }

    /**
     * Narrowed from `string|Htmlable|null`: the page title and the success
     * notification concatenate it. Not `$recordTitleAttribute`, which can't
     * reach `user.username` and would also turn on global search. Takes any
     * `Model` (the page's `getRecord()` is typed so), hence the `instanceof`.
     */
    public static function getRecordTitle(?Model $record): string
    {
        if (! $record instanceof CoachApplication) {
            return 'Coach application';
        }

        return filled($record->user->username) ? $record->user->username : 'Application #'.$record->getKey();
    }

    /**
     * There is no `CoachApplicationPolicy`, and with no policy Filament's
     * fallback is ALLOW for anyone `Gate::before` returns null for — i.e.
     * members and guests (PLAN-COACH-APPLICATION-REVIEW-PAGE.md §2.3).
     * `canAccess()` → `canViewAny()` runs on mount AND hydrate of both
     * pages, so this one override also closes the Livewire round trips
     * `EnsureUserIsAdmin` never sees; the review page needs no
     * `canAccess()` of its own.
     */
    public static function getViewAnyAuthorizationResponse(): Response
    {
        return self::adminTier();
    }

    /** `ViewRecord` checks this per record, and so does the `ViewAction`. */
    public static function getViewAuthorizationResponse(Model $record): Response
    {
        return self::adminTier();
    }

    /** The null actor must DENY — allowing it is the bug being closed. */
    private static function adminTier(): Response
    {
        $actor = auth()->user();

        return $actor !== null && $actor->hasAnyRole(Role::ADMIN_TIER)
            ? Response::allow()
            : Response::deny('Only an administrator may view coach applications.');
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageCoachApplications::route('/'),
            'view' => ViewCoachApplication::route('/{record}'),
        ];
    }
}
