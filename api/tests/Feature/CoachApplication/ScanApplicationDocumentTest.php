<?php

use App\Jobs\ScanApplicationDocument;
use App\Models\ApplicationDocument;
use App\Models\CoachApplication;
use App\Models\User;
use App\Services\Scanning\ClamScannerContract;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;

it('flips a document to clean when the scanner reports clean', function () {
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $application = CoachApplication::query()->create(['user_id' => $user->id, 'status' => 'draft']);
    Storage::disk('application_documents')->put('doc.pdf', '%PDF-1.4 fake');
    $document = ApplicationDocument::query()->create([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'doc.pdf',
        'original_filename' => 'doc.pdf',
        'byte_size' => 10,
        'status' => 'pending_scan',
    ]);

    (new ScanApplicationDocument($document->id))->handle(app(ClamScannerContract::class));

    expect($document->fresh()->status)->toBe('clean');
    expect(Storage::disk('application_documents')->exists('doc.pdf'))->toBeTrue();
});

it('quarantines an infected document: purges storage, keeps the row at infected', function () {
    Storage::fake('application_documents');
    $this->seed(RoleSeeder::class);
    $user = User::factory()->create();
    $application = CoachApplication::query()->create(['user_id' => $user->id, 'status' => 'draft']);
    Storage::disk('application_documents')->put('doc.pdf', '%PDF-1.4 fake');
    $document = ApplicationDocument::query()->create([
        'application_id' => $application->id,
        'disk' => 'application_documents',
        'path' => 'doc.pdf',
        'original_filename' => 'doc.pdf',
        'byte_size' => 10,
        'status' => 'pending_scan',
    ]);

    $infectedScanner = new class implements ClamScannerContract
    {
        public function isClean(string $absolutePath): bool
        {
            return false;
        }
    };

    (new ScanApplicationDocument($document->id))->handle($infectedScanner);

    expect($document->fresh()->status)->toBe('infected');
    expect(Storage::disk('application_documents')->exists('doc.pdf'))->toBeFalse();
});
