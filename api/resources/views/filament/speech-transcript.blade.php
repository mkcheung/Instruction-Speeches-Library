{{-- PLAN-ADMIN-DASHBOARD.md §6.3, FIRST surface — and the cheapest and
     safest one in the whole plan.

     $speech: Speech · $transcript: SpeechTranscript|null

     This needs no new authorization at all. `caption.readCaptions` is
     deliberately excluded from `Gate::before`'s `$mustFallThrough`
     (AppServiceProvider.php:193-200 states the rationale: widening admin
     READ access is not the same failure mode as widening admin WRITE
     access), and `tests/Feature/Captions/SpeechPolicyCaptionsTest.php`
     pins it. Phase 1's §5.2 work extended that to super_admin.

     It is also the only media surface with NO storage round trip, NO
     signed URL and NO bearer token: `speech_transcripts` is a plain DB row
     reached through `Speech::transcript()`. For most moderation — reports
     are usually about WHAT WAS SAID — this is the whole job, which is
     exactly why §6.3 sequences it before the video work.

     The resource queries this with `withTrashed()` on purpose: the public
     API 410s on a trashed speech, which is precisely when a moderator
     reviewing a takedown or an appeal most needs to read it.

     ⚠️ §8.3 — NO Tailwind utility classes. See speech-video.blade.php's
     header for the full reasoning; the short version is that the compiled
     Filament theme contains zero of those selectors and `api/` ships no
     built CSS, so they render as unstyled divs. --}}

<x-filament::section>
    <x-slot name="heading">{{ $speech->title }}</x-slot>

    @if ($transcript === null)
        <x-filament::empty-state
            heading="No transcript"
            description="Captions were never generated for this speech, or the whisper run has not completed. There is nothing derived to read yet."
            icon="heroicon-o-document-text"
        />
    @else
        <x-slot name="description">
            {{ $transcript->word_count }} words ·
            {{ $transcript->language }} ·
            model {{ $transcript->model }} ·
            source {{ $transcript->source }}
        </x-slot>

        {{-- `white-space: pre-wrap` so paragraph breaks in the derived body
             survive, and `{{ }}` (never `{!! !!}`) because this text
             originates from user speech via whisper and is not sanitized
             HTML — it is plain text and must be escaped as such. --}}
        <div style="white-space: pre-wrap; max-height: 60vh; overflow-y: auto;">{{ $transcript->body }}</div>
    @endif
</x-filament::section>
