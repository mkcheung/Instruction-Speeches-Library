{{-- STEP-12-admin-portal.md demo step 8: every annotation grouped by
     reviewer. Read-only — this modal is a view surface only; every write
     path (approve/reject/takedown/suspend) lives in the resource classes
     themselves, never here.

     $groups: reviewer_id => ['reviewer' => User, 'annotations' =>
     Collection<Annotation>] — see SpeechResource::table()'s
     'viewAnnotations' action for how this is assembled. The annotation set
     arrives already filtered by Annotation::scopeVisibleTo
     (PLAN-ADMIN-DASHBOARD.md §5.4, hole 6), so this view renders what it
     is handed and makes no visibility decision of its own. An admin who
     owns the speech therefore sees PUBLISHED rows only, and the way that
     shows up here is a reviewer group with an empty list — which is why
     the inner empty state says what it says rather than "nothing written
     yet".

     ⚠️ §8.3 — NO Tailwind utility classes. This file used `space-y-4`,
     `rounded-lg`, `border-gray-200`, `font-semibold`, `mt-2`, `list-disc`,
     `pl-5`, `text-sm` and `dark:border-gray-700`, and rendered COMPLETELY
     UNSTYLED: `api/` declares a Tailwind toolchain in package.json but has
     no node_modules and no public/build, and the Dockerfile's `webbuild`
     stage builds `web/` only. The compiled Filament theme that IS served
     contains none of those selectors. Every element below is a Filament
     blade component, which is the only styling this panel actually has.

     Two layout facts this file now relies on instead of utilities, both
     read out of the shipped theme.css rather than assumed:
      - Filament renders modal content directly inside `.fi-modal-content`,
        which is `display:flex; flex-direction:column; row-gap:1rem`. So
        top-level siblings are spaced BY THE FRAMEWORK and there is
        deliberately no wrapping <div> — a wrapper would collapse the whole
        list into a single flex child and take that gap away, which is
        precisely the hole `space-y-4` was added to paper over.
      - `.fi-section-content` has no gap of its own, so `divided` (not a
        margin utility) is what separates the annotations inside a group:
        `.fi-section.fi-divided > … > .fi-section-content > *` carries both
        the padding and the rule between rows. --}}
@forelse ($groups as $reviewerId => $group)
    <x-filament::section
        :heading="$group['reviewer']->username ?? 'Reviewer #'.$reviewerId"
        :description="trans_choice(':count annotation|:count annotations', $group['annotations']->count())"
        icon="heroicon-o-chat-bubble-left-right"
        compact
        collapsible
        divided
    >
        @forelse ($group['annotations'] as $annotation)
            <x-filament::section
                :heading="filled($annotation->topic) ? $annotation->topic : 'Untitled note'"
                :contained="false"
                compact
            >
                {{-- One badge, not three: without a gap utility available,
                     adjacent inline-flex badges would touch. The published
                     state is the part a moderator is reading for, so it
                     drives the colour. --}}
                <x-slot name="afterHeader">
                    <x-filament::badge :color="$annotation->published_at === null ? 'warning' : 'success'">
                        {{ $annotation->published_at === null ? 'Draft' : 'Published' }}
                        · {{ $annotation->kind }}
                        · {{ (int) $annotation->start_seconds }}s
                    </x-filament::badge>
                </x-slot>

                {{-- `body` is NULL for a pure voice note and doubles as the
                     TRANSCRIPT when one exists, so it is rendered first
                     either way and the player below is additive. --}}
                @if (filled($annotation->body))
                    {{ $annotation->body }}
                @endif

                {{-- §6.3 surface 2. `$group['audio']` is keyed by
                     annotation, and only annotations that survived
                     `Annotation::scopeVisibleTo` were presigned at all —
                     so an admin who is also the speaker never gets a URL
                     for their own coach's draft voice note. A missing
                     entry here is therefore a DELIBERATE refusal, not a
                     rendering gap, which is why the fallback says the
                     audio is unavailable rather than apologising for an
                     unbuilt feature. --}}
                @php($audio = $group['audio'][$annotation->id] ?? null)

                @if ($audio !== null)
                    {{-- No `crossorigin`: `media:configure-cors` allows the
                         SPA origin only, and the panel is on another host,
                         so any CORS-triggering attribute fails silently.
                         `preload="none"` because a reviewer group can hold
                         many notes and the modal should not fetch them all
                         on open. --}}
                    <audio
                        src="{{ $audio['url'] }}"
                        controls
                        preload="none"
                        style="width: 100%;"
                    >
                        Your browser cannot play this audio.
                    </audio>
                @elseif (blank($annotation->body))
                    <em>Voice note — audio unavailable (still processing, or withheld because you are the speaker on this speech).</em>
                @endif
            </x-filament::section>
        @empty
            <x-filament::empty-state
                heading="Nothing visible on this review"
                description="Either this reviewer has written nothing yet, or you are the speaker on this speech — a speaker never reads a coach's unpublished drafts, including through this panel."
                icon="heroicon-o-eye-slash"
                :contained="false"
                compact
            />
        @endforelse

        {{-- §6.3 surface 2, second half: the essay. A user can report a
             REVIEW (`Report::REPORTABLE_TYPES`), and before this the
             report queue pointed at an essay no moderator could read —
             `Review.essay_html`/`essay_text` were surfaced nowhere in the
             panel at all.

             PUBLISHED essays only: `commentaryGroups()` filters on
             `essay_published_at`, because an unpublished essay is a
             coach's working draft in exactly the sense the annotation
             owner-exclusion protects.

             `{!! !!}` is correct here and nowhere else in this file: the
             string comes from `EssayService::sanitizedHtmlForRead()`,
             which re-sanitizes at READ time precisely so a sanitizer
             bypass stored earlier cannot be served to the
             highest-privilege origin in the system. Never swap this for
             the raw `essay_html` column. --}}
        @foreach ($group['essays'] as $essay)
            <x-filament::section
                heading="Essay"
                :contained="false"
                compact
                collapsible
            >
                <x-slot name="afterHeader">
                    <x-filament::badge color="success">
                        Published {{ $essay['published_at']?->diffForHumans() }}
                    </x-filament::badge>
                </x-slot>

                <div style="max-height: 40vh; overflow-y: auto;">{!! $essay['html'] !!}</div>
            </x-filament::section>
        @endforeach
    </x-filament::section>
@empty
    <x-filament::empty-state
        heading="No reviewers yet"
        description="Nobody has been invited to review this speech, so there is no commentary to read."
        icon="heroicon-o-user-group"
        :contained="false"
    />
@endforelse
