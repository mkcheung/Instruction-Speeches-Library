<?php

use App\Models\SpeechAsset;
use App\Services\Voice\VoiceTranscriptionException;
use App\Services\Voice\WhisperVoiceNoteTranscriber;
use App\Support\ScratchFileAllocationException;
use App\Support\ScratchFiles;
use Illuminate\Support\Facades\Process;

it('cleans only allocated placeholders and siblings and can be cleaned twice', function () {
    $sentinel = tempnam(sys_get_temp_dir(), 'scratch_sentinel_');
    $scratch = new ScratchFiles;
    try {
        file_put_contents($sentinel, 'unrelated');
        $plain = $scratch->create('scratch_plain_');
        $suffixed = $scratch->create('scratch_suffix_', '.wav');
        expect(is_file($plain))->toBeTrue();
        expect(file_exists(substr($suffixed, 0, -4)))->toBeFalse();
        file_put_contents($suffixed, 'audio');
        $scratch->cleanup();
        $scratch->cleanup();

        expect(file_exists($plain))->toBeFalse();
        expect(file_exists($suffixed))->toBeFalse();
        expect(file_get_contents($sentinel))->toBe('unrelated');
    } finally {
        $scratch->cleanup();
        unlink($sentinel);
    }
});

it('handles partial allocation failure without deriving paths from false', function () {
    $scratch = new class extends ScratchFiles
    {
        private int $allocations = 0;

        protected function allocate(string $prefix): string|false
        {
            return ++$this->allocations === 2 ? false : parent::allocate($prefix);
        }
    };
    $first = $scratch->create('scratch_first_', '.m4a');
    file_put_contents($first, 'owned');
    try {
        expect(fn () => $scratch->create('scratch_second_', '.wav'))->toThrow(ScratchFileAllocationException::class);
    } finally {
        $scratch->cleanup();
    }
    expect(file_exists($first))->toBeFalse();
    expect(file_exists(substr($first, 0, -4)))->toBeFalse();
});

it('rejects a suffix that could escape the allocated file sibling', function () {
    expect(fn () => (new ScratchFiles)->create('scratch_invalid_', '/../other'))->toThrow(InvalidArgumentException::class);
});

it('maps voice transcription allocation failure to its existing typed storage failure', function () {
    $this->app->bind(ScratchFiles::class, fn () => new class extends ScratchFiles
    {
        protected function allocate(string $prefix): string|false
        {
            return false;
        }
    });
    Process::fake();

    try {
        (new WhisperVoiceNoteTranscriber)->transcribe(new SpeechAsset);
        $this->fail('Expected the typed voice storage failure.');
    } catch (VoiceTranscriptionException $error) {
        expect($error->failureCode)->toBe('voice_transcription_storage_failed');
    }
    Process::assertNothingRan();
});
