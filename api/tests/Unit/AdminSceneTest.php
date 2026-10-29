<?php

use App\Filament\Auth\MfaChallenge;
use App\Filament\Pages\Dashboard;
use App\Filament\Resources\AuditLogResource\Pages\ManageAuditLogs;
use App\Filament\Resources\CoachApplicationResource\Pages\ManageCoachApplications;
use App\Filament\Resources\CoachApplicationResource\Pages\ViewCoachApplication;
use App\Filament\Resources\ConnectionResource\Pages\ManageConnections;
use App\Filament\Resources\ReportResource\Pages\ManageReports;
use App\Filament\Resources\SpeechResource\Pages\ManageSpeeches;
use App\Filament\Resources\UserResource;
use App\Filament\Resources\UserResource\Pages\ManageUsers;
use App\Filament\Resources\UserResource\Pages\ViewUser;
use App\Support\AdminScene;

it('selects a single scene from rendered page scopes including the resource scope', function (string $page, string $key, bool $compact) {
    expect(AdminScene::forScopes([$page, UserResource::class]))
        ->toBe(['key' => $key, 'compact' => $compact]);
})->with([
    [Dashboard::class, 'dashboard', false],
    [ManageCoachApplications::class, 'coach-applications', false],
    [ViewCoachApplication::class, 'coach-applications', true],
    [ManageUsers::class, 'users', false],
    [ViewUser::class, 'users', true],
    [ManageConnections::class, 'connections', false],
    [ManageAuditLogs::class, 'audit-log', false],
    [ManageReports::class, 'reports', false],
    [ManageSpeeches::class, 'speeches', false],
]);

it('does not infer a character for resource-only, authentication or unknown scopes', function (array $scopes) {
    expect(AdminScene::forScopes($scopes))->toBeNull();
})->with([
    [[]],
    [[UserResource::class]],
    [[MfaChallenge::class]],
    [['/control-panel/users']],
    [['/livewire/update']],
    [['UnknownPage']],
]);

it('renders only the selected decorative SVG without focusable elements or shared ids', function (string $page) {
    $scene = AdminScene::forScopes([$page]);
    $html = view('filament.admin.header-scene', ['scene' => $scene])->render();

    expect(substr_count($html, '<svg'))->toBe(1)
        ->and($html)->toContain('data-admin-scene="'.$scene['key'].'"', 'aria-hidden="true"', 'focusable="false"')
        ->not->toMatch('/\s(?:id|tabindex|href|wire:click|x-on:click)\s*=/i')
        ->not->toMatch('/<(?:a|button|input|script)\b/i');

    if ($scene['compact']) {
        expect($html)->toContain('admin-workspace-scene--compact');
    }
})->with([
    Dashboard::class, ManageCoachApplications::class, ViewCoachApplication::class,
    ManageUsers::class, ViewUser::class, ManageConnections::class,
    ManageAuditLogs::class, ManageReports::class, ManageSpeeches::class,
]);
