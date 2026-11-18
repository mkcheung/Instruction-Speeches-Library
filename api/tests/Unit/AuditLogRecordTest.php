<?php

use App\Models\AuditLog;
use App\Models\User;
use App\Support\AuditAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;

uses(RefreshDatabase::class);

it('records all audit fields with the supplied request and round-trips metadata', function () {
    $this->travelTo(now()->startOfSecond());
    $actor = User::factory()->create();
    $subject = User::factory()->create();
    $metadata = ['reason' => 'Review complete', 'context' => ['ids' => [1, 2], 'allowed' => true, 'detail' => null]];
    $request = Request::create('/audit', server: [
        'REMOTE_ADDR' => '2001:db8::1',
        'HTTP_USER_AGENT' => 'AuditLogRecordTest/1.0',
    ]);

    $log = AuditLog::record(
        action: AuditAction::USER_SUSPENDED,
        actorId: $actor->id,
        subjectType: User::class,
        subjectId: $subject->id,
        metadata: $metadata,
        request: $request,
    );

    expect($log->exists)->toBeTrue();
    $log->refresh();

    expect($log->actor_id)->toBe($actor->id)
        ->and($log->action)->toBe(AuditAction::USER_SUSPENDED)
        ->and($log->subject_type)->toBe(User::class)
        ->and($log->subject_id)->toBe($subject->id)
        ->and($log->metadata)->toBe($metadata)
        ->and($log->ip)->toBe('2001:db8::1')
        ->and($log->user_agent)->toBe('AuditLogRecordTest/1.0')
        ->and($log->created_at->equalTo(now()))->toBeTrue()
        ->and($log->getAttributes())->not->toHaveKey('updated_at');
});

it('records nullable actor and subject fields without borrowing the ambient request', function () {
    $this->travelTo(now()->startOfSecond());
    app('request')->server->set('REMOTE_ADDR', '192.0.2.1');
    app('request')->headers->set('User-Agent', 'Ambient request');

    $log = AuditLog::record(
        action: AuditAction::SPEECH_MEDIA_PURGED,
        actorId: null,
        subjectType: null,
        subjectId: null,
        metadata: [],
    );

    $log->refresh();

    expect($log->actor_id)->toBeNull()
        ->and($log->action)->toBe(AuditAction::SPEECH_MEDIA_PURGED)
        ->and($log->subject_type)->toBeNull()
        ->and($log->subject_id)->toBeNull()
        ->and($log->metadata)->toBe([])
        ->and($log->ip)->toBeNull()
        ->and($log->user_agent)->toBeNull()
        ->and($log->created_at->equalTo(now()))->toBeTrue();
});
