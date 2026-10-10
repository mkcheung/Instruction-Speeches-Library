{{-- PLAN-ADMIN-DASHBOARD.md §6.3, third surface: admin video review.

     $speech: Speech · $asset: SpeechAsset|null · $url: string|null ·
     $refusal: string|null

     Two mutually exclusive states, and the refusal one is not an error
     page. `SpeechResource::playableVideo()` returns null for a trashed
     speech, a non-`ready` rendition, or no primary rendition at all — and
     in every one of those cases the action deliberately mints NO presigned
     URL and writes NO audit row. Telling the moderator WHICH of the three
     it is costs nothing and is the difference between "the panel is
     broken" and "the transcode never finished".

     ⚠️ §8.3 — NO Tailwind utility classes anywhere in this file. The
     compiled Filament theme (`vendor/filament/filament/dist/theme.css`)
     contains none of them: `space-y-4`, `rounded-lg`, `border-gray-200`
     and friends have ZERO selectors in it, and `api/` has no built CSS of
     its own (package.json declares a Tailwind toolchain, but there is no
     node_modules, no public/build, and the Dockerfile's webbuild stage
     builds `web/` only). Two sibling modals shipped using exactly those
     classes and rendered as unstyled divs. Filament's own blade components
     are the only styled vocabulary available here.

     ⚠️ No `crossorigin` attribute and no `<track>` element, deliberately.
     `media:configure-cors` builds AllowedOrigins from
     `config('cors.allowed_origins')`, which lists the SPA origin only —
     the panel is served from a different host, so anything that triggers a
     CORS preflight fails silently. A plain `<video src>` needs no CORS
     grant and works. --}}

<x-filament::section>
    <x-slot name="heading">{{ $speech->title }}</x-slot>

    @if ($refusal !== null)
        <x-filament::empty-state
            heading="Playback unavailable"
            :description="$refusal"
            icon="heroicon-o-video-camera-slash"
        />
    @else
        {{-- `controls` only: no autoplay (a moderator opening a queue of
             reports does not want audio firing), and `preload="metadata"`
             so opening the modal does not pull the whole rendition before
             anyone presses play. --}}
        <video
            src="{{ $url }}"
            controls
            preload="metadata"
            style="width: 100%; max-height: 70vh; background: #000;"
        >
            Your browser cannot play this video.
        </video>

        {{-- ⚠️ `footer`, NOT `footerActions`. `x-filament::section`'s
             @props list is `afterHeader / aside / collapsed / collapseId /
             collapsible / compact / contained / contentBefore /
             description / divided / footer / hasContentEl / heading /
             headingTag / icon / iconColor / iconSize / persistCollapsed /
             secondary` — there is no `footerActions` slot anywhere in
             `filament/support`, only a `footerActions()` METHOD on schema
             components (Callout/Section PHP objects), which is a different
             thing entirely. A slot the component never renders is dropped
             silently, so this badge did not exist on screen and
             `SpeechResource::panelMediaTtlMinutes()` had no live caller —
             exactly the failure mode §8.3 is about, one layer up. --}}
        <x-slot name="footer">
            <x-filament::badge color="warning">
                Signed link expires in {{ \App\Filament\Resources\SpeechResource::panelMediaTtlMinutes() }} minutes
            </x-filament::badge>
        </x-slot>
    @endif
</x-filament::section>
