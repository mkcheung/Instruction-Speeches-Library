{{-- STEP-12-admin-portal.md demo step 4: "Click a PDF. It opens on a
     different origin, as a download... never inline on the panel's own
     origin." Every link below is a real `<a target="_blank">` to a
     signed `ApplicationDocumentDownloadController` URL — the controller
     forces `Content-Disposition: attachment` + `X-Content-Type-Options:
     nosniff`, so even a click that somehow rendered would download
     rather than display.

     $documents: Collection<{document: ApplicationDocument, url: string}>

     ⚠️ §8.3 — NO Tailwind utility classes. This file used `space-y-2`,
     `flex`, `items-center`, `justify-between`, `rounded-lg`,
     `border-gray-200`, `p-3`, `text-sm`, `hover:bg-gray-50`,
     `text-xs`, `text-gray-500`, `dark:border-gray-700` and
     `dark:hover:bg-gray-800`, and rendered COMPLETELY UNSTYLED — the
     bordered, hoverable rows it describes have never existed on screen,
     because the compiled Filament theme this panel serves contains none
     of those selectors and `api/` has no built CSS at all. See the
     sibling `speech-annotations-by-reviewer.blade.php` header for the
     full reason and for the two Filament layout facts replacing the
     utilities (modal content is a flex column with a row gap, so there is
     no wrapping <div>; `divided` is what separates rows).

     `x-filament::link` carries the whole affordance the hand-rolled
     classes were reaching for — colour, hover, focus ring, icon slot —
     and it takes `href`/`target`/`rel` straight through, so the
     attachment-forcing behaviour above is untouched by the change. --}}
<x-filament::section
    heading="Submitted credentials"
    description="Each file opens on the media origin as a download, never inline here."
    icon="heroicon-o-document-text"
    compact
    divided
>
    @forelse ($documents as $entry)
        <x-filament::link
            :href="$entry['url']"
            target="_blank"
            rel="noopener noreferrer"
            icon="heroicon-o-arrow-down-tray"
            :badge="\Illuminate\Support\Str::limit($entry['document']->sha256, 12, '…')"
            badge-color="gray"
            badge-size="xs"
        >
            {{ $entry['document']->original_filename }}
        </x-filament::link>
    @empty
        <x-filament::empty-state
            heading="No clean documents yet"
            description="Uploads appear here once the malware scan reports them clean; a pending or infected document is never linkable from this panel."
            icon="heroicon-o-shield-exclamation"
            :contained="false"
            compact
        />
    @endforelse
</x-filament::section>
