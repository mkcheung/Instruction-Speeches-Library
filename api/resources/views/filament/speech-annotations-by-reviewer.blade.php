{{-- STEP-12-admin-portal.md demo step 8: every annotation grouped by
     reviewer. Read-only — this modal is a view surface only; every write
     path (approve/reject/takedown/suspend) lives in the resource classes
     themselves, never here.

     $groups: reviewer_id => ['reviewer' => User, 'annotations' =>
     Collection<Annotation>] — see SpeechResource::table()'s
     'viewAnnotations' action for how this is assembled. --}}
<div class="space-y-4">
    @forelse ($groups as $reviewerId => $group)
        <div class="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p class="font-semibold">
                {{ $group['reviewer']->username ?? 'Reviewer #'.$reviewerId }}
            </p>
            <ul class="mt-2 list-disc pl-5 text-sm">
                @forelse ($group['annotations'] as $annotation)
                    <li>{{ $annotation->body }} ({{ $annotation->kind }}, {{ $annotation->start_seconds }}s)</li>
                @empty
                    <li class="list-none text-gray-500">No annotations yet.</li>
                @endforelse
            </ul>
        </div>
    @empty
        <p>No reviewers yet.</p>
    @endforelse
</div>
