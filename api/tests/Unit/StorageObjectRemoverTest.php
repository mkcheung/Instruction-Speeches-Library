<?php

use App\Services\StorageObjectRemover;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

it('removes only the explicit existing objects and treats missing objects as complete', function () {
    Storage::fake('remover-test');
    Storage::disk('remover-test')->put('claimed/input', 'owned');
    Storage::disk('remover-test')->put('unrelated/sentinel', 'preserve');

    $remover = new StorageObjectRemover;
    $remover->deleteExisting('remover-test', ['claimed/input', 'claimed/missing'], 'caller failure');
    $remover->deleteExisting('remover-test', ['claimed/input'], 'caller failure');

    Storage::disk('remover-test')->assertMissing('claimed/input');
    expect(Storage::disk('remover-test')->get('unrelated/sentinel'))->toBe('preserve');
});

it('keeps a failed deletion visible with its caller-specific error and stops before later paths', function () {
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('exists')->once()->with('claimed/failed')->andReturnTrue();
    $disk->shouldReceive('delete')->once()->with('claimed/failed')->andReturnFalse();
    $disk->shouldNotReceive('exists')->with('claimed/later');
    Storage::shouldReceive('disk')->with('remover-test')->andReturn($disk);

    expect(fn () => (new StorageObjectRemover)->deleteExisting('remover-test', ['claimed/failed', 'claimed/later'], 'original caller message'))
        ->toThrow(RuntimeException::class, 'original caller message');
});

it('propagates storage exceptions instead of treating them as missing data', function () {
    $failure = new RuntimeException('storage connection failed');
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('exists')->once()->with('claimed/input')->andThrow($failure);
    Storage::shouldReceive('disk')->with('remover-test')->andReturn($disk);

    expect(fn () => (new StorageObjectRemover)->deleteExisting('remover-test', ['claimed/input'], 'caller failure'))->toThrow($failure);
});
