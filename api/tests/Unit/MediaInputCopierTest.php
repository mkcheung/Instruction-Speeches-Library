<?php

use App\Services\MediaInputCopier;
use App\Support\ScratchFiles;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

it('checks known input lengths while retaining unknown-length copies', function (int $expected, bool $success) {
    $source = fopen('php://temp', 'w+b');
    fwrite($source, 'sample');
    rewind($source);
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('readStream')->once()->with('claimed-input')->andReturn($source);
    Storage::shouldReceive('disk')->once()->with('copy-test')->andReturn($disk);
    $scratch = new ScratchFiles;
    try {
        $local = $scratch->create('copy_test_');
        expect((new MediaInputCopier)->copy('copy-test', 'claimed-input', $local, $expected))->toBe($success);
        expect(file_get_contents($local))->toBe('sample');
        expect(is_resource($source))->toBeFalse();
    } finally {
        $scratch->cleanup();
    }
})->with([[6, true], [7, false], [5, false], [0, true]]);

it('closes its input when a local destination cannot be opened', function () {
    $source = fopen('php://temp', 'w+b');
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('readStream')->andReturn($source);
    Storage::shouldReceive('disk')->with('copy-test')->andReturn($disk);
    $scratch = new ScratchFiles;
    try {
        $existingFile = $scratch->create('copy_parent_');
        expect((new MediaInputCopier)->copy('copy-test', 'input', $existingFile.'/output'))->toBeFalse();
        expect(is_resource($source))->toBeFalse();
    } finally {
        $scratch->cleanup();
    }
});

it('retains unreadable-input and storage-exception behavior', function () {
    $disk = Mockery::mock(FilesystemAdapter::class);
    $disk->shouldReceive('readStream')->once()->with('missing')->andReturnNull();
    $failure = new RuntimeException('storage unavailable');
    $disk->shouldReceive('readStream')->once()->with('throws')->andThrow($failure);
    Storage::shouldReceive('disk')->with('copy-test')->andReturn($disk);

    expect((new MediaInputCopier)->copy('copy-test', 'missing', 'unused'))->toBeFalse();
    expect(fn () => (new MediaInputCopier)->copy('copy-test', 'throws', 'unused'))->toThrow($failure);
});

class ExplodingMediaInputStream
{
    public mixed $context;

    public static bool $closed = false;

    public function stream_open(): bool
    {
        return true;
    }

    public function stream_read(): string
    {
        throw new RuntimeException('stream interrupted');
    }

    public function stream_eof(): bool
    {
        return false;
    }

    public function stream_stat(): array
    {
        return [];
    }

    public function stream_close(): void
    {
        self::$closed = true;
    }
}

it('closes acquired handles and propagates a stream-copy exception', function () {
    stream_wrapper_register('media-copy-failure', ExplodingMediaInputStream::class);
    ExplodingMediaInputStream::$closed = false;
    $scratch = new ScratchFiles;
    try {
        $source = fopen('media-copy-failure://input', 'rb');
        $disk = Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('readStream')->andReturn($source);
        Storage::shouldReceive('disk')->with('copy-test')->andReturn($disk);
        $local = $scratch->create('copy_exception_');

        expect(fn () => (new MediaInputCopier)->copy('copy-test', 'input', $local))->toThrow(RuntimeException::class, 'stream interrupted');
        expect(ExplodingMediaInputStream::$closed)->toBeTrue();
        expect(is_resource($source))->toBeFalse();
    } finally {
        $scratch->cleanup();
        stream_wrapper_unregister('media-copy-failure');
    }
});
