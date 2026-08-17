<?php

return [

    /*
    |--------------------------------------------------------------------------
    | whisper.cpp binary + model (STEP-09-captions.md, frozen contract §6)
    |--------------------------------------------------------------------------
    |
    | Consulted only by App\Services\Captions\WhisperTranscriber — the
    | testing/CI binding is App\Services\Captions\FakeCaptionTranscriber,
    | which never shells out at all (mirrors TranscoderContract's
    | Fake/Ffmpeg split). `model_path` points at the read-only
    | `whisper-models` named volume mounted into the `whisper-worker`
    | compose service (compose.yaml) — never baked into any image, per
    | STEP-09.md's "mount them as a volume rather than baking them into
    | the image".
    |
    | `model_name` is recorded verbatim onto every speech_transcripts row
    | (§ acceptance: "model is recorded on every transcript") — it is NOT
    | read back from the binary/model file, since whisper.cpp's CLI output
    | doesn't self-report a stable model identifier; the deploy-time model
    | choice IS the identifier.
    |
    */

    'whisper_binary' => env('WHISPER_BINARY', '/usr/local/bin/whisper-cli'),

    'model_path' => env('WHISPER_MODEL_PATH', '/models/ggml-base.en.bin'),

    'model_name' => env('WHISPER_MODEL_NAME', 'whisper.cpp-base.en'),

    'language' => env('WHISPER_LANGUAGE', 'en'),

    // Wall-clock ceiling for one whisper.cpp invocation (App\Jobs\
    // GenerateCaptions's own $timeout is set above this, same ordering
    // TranscodeSpeechAsset keeps against `redis-long`'s retry_after).
    'timeout_seconds' => (int) env('WHISPER_TIMEOUT_SECONDS', 1800),

];
