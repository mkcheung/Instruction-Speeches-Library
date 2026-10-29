<?php

namespace App\Support;

use App\Filament\Pages\Dashboard;
use App\Filament\Resources\AuditLogResource\Pages\ManageAuditLogs;
use App\Filament\Resources\CoachApplicationResource\Pages\ManageCoachApplications;
use App\Filament\Resources\CoachApplicationResource\Pages\ViewCoachApplication;
use App\Filament\Resources\ConnectionResource\Pages\ManageConnections;
use App\Filament\Resources\ReportResource\Pages\ManageReports;
use App\Filament\Resources\SpeechResource\Pages\ManageSpeeches;
use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Filament\Resources\UserResource\Pages\ViewUser;

/** Decorative page context only; resource authorization remains in Filament. */
final class AdminScene
{
    /** @var array<class-string, array{key: string, compact: bool}> */
    private const PAGES = [
        Dashboard::class => ['key' => 'dashboard', 'compact' => false],
        ManageCoachApplications::class => ['key' => 'coach-applications', 'compact' => false],
        ViewCoachApplication::class => ['key' => 'coach-applications', 'compact' => true],
        ManageUsers::class => ['key' => 'users', 'compact' => false],
        ViewUser::class => ['key' => 'users', 'compact' => true],
        ManageConnections::class => ['key' => 'connections', 'compact' => false],
        ManageAuditLogs::class => ['key' => 'audit-log', 'compact' => false],
        ManageReports::class => ['key' => 'reports', 'compact' => false],
        ManageSpeeches::class => ['key' => 'speeches', 'compact' => false],
    ];

    /**
     * Resolve the current rendered page, including during Livewire updates.
     * Resource-only, authentication and unknown scopes deliberately have no art.
     *
     * @param  array<string>  $scopes
     * @return array{key: string, compact: bool}|null
     */
    public static function forScopes(array $scopes): ?array
    {
        foreach ($scopes as $scope) {
            if (isset(self::PAGES[$scope])) {
                return self::PAGES[$scope];
            }
        }

        return null;
    }
}
