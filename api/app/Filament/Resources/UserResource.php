<?php

namespace App\Filament\Resources;

use App\Exceptions\LastAdministratorException;
use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\RoleAssignmentService;
use App\Services\UserDeletionService;
use App\Support\AuditAction;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * STEP-12-admin-portal.md: "user list with a role filter — the legacy app
 * could not filter by role, so 'show me all coaches' was impossible."
 *
 * NON-NEGOTIABLE (STEP-12-FROZEN-CONTRACT.md §11/§3): every action here
 * that changes a role or suspends/deletes a user calls
 * `RoleAssignmentService`/`UserDeletionService` — never `assignRole()`/
 * `delete()` directly, including inside a BULK action, per §7.4's own
 * warning that bulk actions bypass policies.
 *
 * Every action below now also calls `Gate::authorize(...)` before writing
 * — found missing entirely by `/code-review` (two independent finder
 * angles): none of these closures called the Gate at all, so
 * `UserPolicy::suspend()`'s self-exclusion was dead code reachable only
 * by direct `Gate::forUser()` tests, and an admin could suspend
 * themselves through this exact UI. `AuthorizationException` is caught
 * the same way `LastAdministratorException` already was, so a denial
 * shows a Notification instead of Filament's raw 403 page.
 *
 * There is deliberately NO "Grant coach" action here. §6.8/user-
 * constraints.md: "Only an Admin can create a Coach, and only after
 * reviewing certification PDFs the user uploaded" — the only legal path
 * to the `coach` role is `CoachApplicationDecisionService::approve()`
 * (`CoachApplicationResource`'s "approve" action). An earlier version of
 * this file had a standalone "Grant coach" button here with no
 * application/document precondition at all, bypassing the entire
 * certification-review requirement — found by `/code-review`'s
 * conventions angle against that exact rule. "Revoke coach" (demotion)
 * stays: §6.8 explicitly treats demotion as a separate, unconditional
 * admin power ("their existing reviews survive... demotion removes
 * reach, not history"), unlike promotion.
 */
class UserResource extends Resource
{
    protected static ?string $model = User::class;

    protected static ?string $navigationLabel = 'Users';

    public static function form(Schema $schema): Schema
    {
        return $schema->components([]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('id')->sortable(),
                TextColumn::make('username')->searchable(),
                TextColumn::make('email')->searchable(),
                TextColumn::make('roles.name')->badge()->label('Roles'),
                TextColumn::make('suspended_at')->label('Suspended')->dateTime(),
                TextColumn::make('deleted_at')->label('Deleted')->dateTime(),
            ])
            ->filters([
                SelectFilter::make('roles')
                    ->relationship('roles', 'name')
                    ->label('Role')
                    ->options(['super_admin' => 'Super admin', 'admin' => 'Admin', 'coach' => 'Coach', 'member' => 'Member']),
            ])
            ->recordActions([
                Action::make('revokeCoach')
                    ->label('Revoke coach')
                    ->visible(fn (User $record) => $record->hasRole('coach'))
                    ->requiresConfirmation()
                    ->action(function (User $record) {
                        $actor = auth()->user();

                        try {
                            Gate::authorize('role.revoke', $record);
                            app(RoleAssignmentService::class)->revoke($actor, $record, 'coach');
                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => AuditAction::ROLE_REVOKED,
                                'subject_type' => User::class,
                                'subject_id' => $record->id,
                                'metadata' => ['role' => 'coach'],
                                'created_at' => now(),
                            ]);
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
                Action::make('toggleSuspend')
                    ->label(fn (User $record) => $record->suspended_at ? 'Unsuspend' : 'Suspend')
                    ->requiresConfirmation()
                    ->action(function (User $record) {
                        $actor = auth()->user();
                        $service = app(UserDeletionService::class);

                        try {
                            if ($record->suspended_at) {
                                $service->unsuspend($actor, $record);
                                $action = AuditAction::USER_UNSUSPENDED;
                            } else {
                                Gate::authorize('user.suspend', $record);
                                $service->suspend($actor, $record);
                                $action = AuditAction::USER_SUSPENDED;
                            }

                            AuditLog::query()->create([
                                'actor_id' => $actor->id,
                                'action' => $action,
                                'subject_type' => User::class,
                                'subject_id' => $record->id,
                                'metadata' => [],
                                'created_at' => now(),
                            ]);
                        } catch (AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
            ])
            ->toolbarActions([
                BulkAction::make('suspendSelected')
                    ->label('Suspend selected (max 25)')
                    ->requiresConfirmation()
                    ->action(function (Collection $records) {
                        $actor = auth()->user();

                        try {
                            // §7.4/§3: still through UserDeletionService's
                            // own cap + per-target last-admin guard, never
                            // a raw ->each->update() on the collection.
                            // `values()` reindexes to a list<User> —
                            // `$records` may arrive with non-sequential
                            // keys (e.g. after table filtering/sorting),
                            // and `suspendMany()`'s signature requires a
                            // list, not an arbitrary keyed array.
                            /** @var list<User> $targets */
                            $targets = $records->values()->all();
                            foreach ($targets as $target) {
                                Gate::authorize('user.suspend', $target);
                            }
                            app(UserDeletionService::class)->suspendMany($actor, $targets);
                        } catch (\InvalidArgumentException|AuthorizationException|LastAdministratorException $e) {
                            Notification::make()->danger()->title($e->getMessage())->send();
                        }
                    }),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ManageUsers::route('/'),
        ];
    }
}
