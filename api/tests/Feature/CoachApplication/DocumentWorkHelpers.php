<?php

use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Models\User;
use App\Services\Scanning\ClamScannerContract;
use App\Services\StorageObjectRemover;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;

/** @param array<string, mixed> $overrides */
function workDocument(array $overrides = [], bool $withBytes = true): ApplicationDocument
{
    static $seeded = false;
    Storage::fake('application_documents');
    if (! $seeded || User::query()->count() === 0) {
        test()->seed(RoleSeeder::class);
        $seeded = true;
    }
    $user = User::factory()->create();
    $application = CoachApplication::query()->create(['user_id' => $user->id, 'status' => 'draft']);
    $path = $overrides['path'] ?? 'applications/'.$application->id.'/doc.pdf';
    if ($withBytes && $path !== '') {
        Storage::disk('application_documents')->put($path, '%PDF-1.4 fake');
    }

    $document = new ApplicationDocument;
    $document->forceFill(array_merge([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => $path,
        'original_filename' => 'doc.pdf',
        'byte_size' => 10,
        'sha256' => str_repeat('a', 64),
        'status' => 'pending_scan',
    ], $overrides))->save();

    return $document->fresh();
}

function fakeScanner(bool|Closure $verdict): ClamScannerContract
{
    return new class($verdict) implements ClamScannerContract
    {
        public int $calls = 0;

        public function __construct(private bool|Closure $verdict) {}

        public function isClean(string $absolutePath): bool
        {
            $this->calls++;

            return $this->verdict instanceof Closure ? ($this->verdict)($absolutePath) : $this->verdict;
        }
    };
}

/** Remover double: 'ok' really deletes, 'false'/'throw' fail, records every call. */
function fakeRemover(string $mode = 'ok'): StorageObjectRemover
{
    $remover = new class($mode) extends StorageObjectRemover
    {
        /** @var list<array{string, list<string>}> */
        public array $calls = [];

        public function __construct(private string $mode) {}

        public function deleteExisting(string $disk, array $paths, string $failureMessage): void
        {
            $this->calls[] = [$disk, $paths];
            if ($this->mode === 'throw') {
                throw new RuntimeException('boom');
            }
            if ($this->mode === 'false') {
                throw new RuntimeException($failureMessage);
            }
            parent::deleteExisting($disk, $paths, $failureMessage);
        }
    };
    app()->instance(StorageObjectRemover::class, $remover);

    return $remover;
}
