{{-- STEP-12-admin-portal.md demo step 4: "Click a PDF. It opens on a
     different origin, as a download... never inline on the panel's own
     origin." Every link below is a real `<a target="_blank">` to a
     signed `ApplicationDocumentDownloadController` URL — the controller
     forces `Content-Disposition: attachment` + `X-Content-Type-Options:
     nosniff`, so even a click that somehow rendered would download
     rather than display.

     $documents: Collection<{document: ApplicationDocument, url: string}> --}}
<div class="space-y-2">
    @forelse ($documents as $entry)
        <a
            href="{{ $entry['url'] }}"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-between rounded-lg border border-gray-200 p-3 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
            <span>{{ $entry['document']->original_filename }}</span>
            <span class="text-xs text-gray-500">{{ \Illuminate\Support\Str::limit($entry['document']->sha256, 12, '…') }}</span>
        </a>
    @empty
        <p>No clean (scanned) documents yet.</p>
    @endforelse
</div>
