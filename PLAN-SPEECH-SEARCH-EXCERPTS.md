# Speech search: titles, descriptions, and matching transcript excerpts

Status: implementation and independent review complete on `feat/speech-search-excerpts`, started from `82a612c`. The reviewed design below remains revision 2; execution evidence and validation boundaries are recorded in §11. Search changes remain unstaged and uncommitted; no application deployment was performed.

Prepared 2026-10-20 against `development`, commit `82a612c`. The worktree was clean before this new plan. The screenshot is a requested UI reference; source inspection, not a browser session or development-database inspection, establishes the current behavior below.

## 1. Requested behavior and explicit decisions

The existing `/search` page should find the signed-in user's speeches when the entered text matches **any** of these:

1. Speech title.
2. Speech description.
3. The available, persisted transcript of the speech itself.

Keep the existing cards beneath the input. Each result displays its title, its description when nonempty, and a short transcript excerpt **only when that transcript contains the search text**. Highlight matching visible text in yellow, including title/description matches. A metadata-only match must not acquire an arbitrary transcript preview. A speech matching several fields appears once.

Proposed matching semantics: trim the query's outer whitespace; perform case-insensitive **literal substring** matching. Multiple words form one contiguous phrase, not an unordered collection of words. Punctuation, `%`, `_`, backslash, and regular-expression metacharacters are literal. No stemming, fuzzy matching, synonym expansion, accent removal, or Unicode normalization is introduced. For example, `district final` must occur together, and `final` may match inside `finalists`. Internal spaces remain significant; canonical transcript bodies already normalize cue whitespace.

This deliberately changes PostgreSQL's current English full-text behavior. A search for separated words or a morphological variant may stop matching; literal stopword phrases such as `to be` can start matching. These are consequences of making eligibility and visible yellow text correspond to what the user typed.

Retain owner-only scope, current newest-first ordering, the current result envelope, and the existing authenticated/verified page access. Do not silently broaden search to review assignments, other users' speeches, essays, voice-note transcripts, or unpublished annotations.

The word “dropdown” refers here to the existing result cards immediately below the input. Do not introduce a popup combobox, overlay, arrow-key selection model, search suggestions, or player seek links. Ordinary links remain keyboard accessible.

## 2. Three explorer reports, reconciled with source

Three independent read-only explorers covered frontend, backend, and schema/Whisper lifecycle. The coordinator inspected the primary files and existing tests to reconcile their findings.

| Area | Current implementation and evidence | Required consequence |
|---|---|---|
| Page | `web/src/routes/Search.tsx:21` debounces 300 ms, trims, skips blank requests, and refetches on remount. Lines 81–94 render a title link and description, with no excerpt or highlighting. | Preserve the interaction and add query-specific result presentation. Repeated text in the screenshot comes from the stored description rendered directly; the page does not duplicate the title into it. |
| API client/type | `web/src/features/transcript/transcriptApi.ts:41` queries `/api/speeches/search`, unwraps `{results: ...}`, and provides a `Search` cache tag. `features/transcript/types.ts:64` currently aliases the full `Speech` type. | Extend the search-specific result type, without adding search fields to general speech responses. |
| Stale state | `Search.tsx:30` reads RTK Query `data`; results rendering is not gated by empty/current query or errors. | Hide old-query results immediately on input change/clear and use current-argument data. Never highlight a previous query's results using the new input. |
| Route and authorization | `api/routes/api.php:110` registers literal `/speeches/search` before the parameterized speech route. `TranscriptController.php:77` filters `user_id` to the caller. `Speech.php` uses `SoftDeletes`. | Preserve route ordering, authentication, owner scope, and soft-delete exclusion around every OR alternative. |
| Current SQL | `TranscriptController.php:88` uses transcript-only `whereHas`; PostgreSQL uses `body_tsv @@ plainto_tsquery('english', ?)`, SQLite uses escaped `LIKE`. | Add title/description alternatives and deliberately replace linguistic full-text eligibility for this endpoint. Existing drivers do not currently have identical semantics. |
| Resource | `api/app/Http/Resources/SpeechResource.php:57` already includes title/description and existing media/version fields. | Compose or extend this resource for search; retain those fields and add bounded, plain-text match metadata. |
| Speech schema | `api/database/migrations/2026_08_08_150002_create_speeches_table.php:63`: required title VARCHAR(255), nullable description VARCHAR(2000); owner index at line 85. | Existing columns suffice. Null description is ordinary. |
| Transcript schema | `2026_08_17_100002_create_speech_transcripts_table.php:69`: one unique transcript per speech, text body, timed segments, `whisper`/`edited` sources; PostgreSQL generated English tsvector and GIN index. `2026_08_18_100001_add_revision_columns_to_captions_and_transcripts.php` adds projection revision tokens. | No migration or backfill needed. Do not remove existing columns/indexes. |
| Projection lifecycle | `WhisperTranscriber.php:176–216` publishes ready captions and the derived transcript transactionally. `TranscriptDeriver.php:28–31` joins normalized cue text with spaces. `RederiveTranscript.php:184–227` replaces the projection after edited VTT converges. | Search existing `body`, including phrases across cue boundaries and edited text. Do not search each cue separately or read VTT/object storage during requests. |
| Retained projections | `EnsureCaptionJob.php:95–100` retains existing ready captions when automation is disabled. `PurgeSpeechMedia.php:56–59` retains transcript history; soft-deleted speeches remain excluded. | Do not add an unrelated captions-enabled/ready/source-only filter that would suppress existing usable projections. |
| Cache convergence | `web/src/hooks/useCaptionEditor.ts:72` invalidates Transcript/Search after revision convergence, not immediately on caption PUT. `web/tests/captions.spec.ts:460` tests this with real PostgreSQL. | Preserve asynchronous convergence, remount refetch, owner-isolation controls, and the existing browser scenario. |

Explorer recommendations agree: use the existing projection and owner boundary, add a search-only resource contract, render escaped text fragments rather than HTML, and test PostgreSQL directly.

## 3. API and presentation contract

Keep `GET /api/speeches/search?q=...` and `{ "results": [...] }`. Existing result fields remain unchanged. Add a search-only `search_match` object through a new `SpeechSearchResource`:

```ts
type SearchTextPart = { text: string; matched: boolean }

type SpeechSearchResult = Speech & {
  search_match: {
    title: SearchTextPart[]
    description: SearchTextPart[] | null
    transcript_excerpt: {
      parts: SearchTextPart[]
      truncated_before: boolean
      truncated_after: boolean
    } | null
  }
}
```

These are ordinary JSON strings and booleans, never HTML or encoded HTML. Concatenating title parts must reproduce the original title; description parts must reproduce the original description when nonempty. A field with no match still has an unmarked text part. A null/empty description gets null metadata and no description element. Empty fragments should not be emitted.

`transcript_excerpt` is null unless the persisted body actually matches the effective query. When present, at least one part must be marked and the full matching phrase must fit in the excerpt. Do not return the entire transcript body, segments, or arbitrary alternate text as search metadata.

The frontend renders these parts with React text nodes and `<mark>` elements. It does not redo matching or interpret offsets. This avoids PHP byte/codepoint versus JavaScript UTF-16 indexing disagreements and avoids injecting user-supplied speech content into HTML. Title links keep their complete accessible title even when wrapped in marks. No `dangerouslySetInnerHTML`, HTML sanitization package, or delimiter-based HTML parsing is needed.

Existing clients ignoring additive search metadata keep working. During a mixed-version rollout, the new UI should gracefully show plain title/description when old responses lack `search_match`; it must not fabricate an excerpt or highlights. Coordinate backend/frontend publication and refetch search data rather than retaining incompatible cached objects.

## 4. Backend design

### 4.1 Query, scope, and literal escaping

Move the matching/query/excerpt details into a small search service, proposed `api/app/Services/Search/SpeechSearch.php`, rather than expanding transcript read behavior. `TranscriptController::show` remains unchanged; `search` validates the query, delegates, and returns search resources.

The predicate must have this shape:

```text
speech belongs to current user
AND speech is not soft-deleted
AND (title matches OR description matches OR related transcript body matches)
```

Use bound parameters, never interpolated SQL. PostgreSQL literal case-insensitive matching can use `ILIKE`; the SQLite fallback can use its case-insensitive `LIKE` for its supported cases. Use an explicit single-character escape such as `!`: escape `!` first, then `%` and `_`, then add the surrounding substring wildcards. A backslash is then ordinary text. The existing fallback escapes `%`/`_` but not the escape character itself; replace that behavior consistently rather than copying its defect.

Group all alternatives inside the owner/soft-delete conditions. Use a related EXISTS predicate or a unique left join; either must admit metadata matches without a transcript. Do not use an inner join, require a transcript globally, change to `scopeVisibleTo`, or introduce an ungrouped `orWhere`.

Preserve newest-first results, with an ID tie-breaker for deterministic equal timestamps. Preserve the unbounded collection contract for this change; do not silently cap results or introduce pagination/`has_more`. Retain existing constrained relationship eager loads required by `SpeechResource`. Load transcript identification and body fields in a bounded number of queries, never once per result; do not fetch its potentially large `segments` JSON. Do not load all owner transcripts into PHP before database filtering.

### 4.2 Case behavior and production validation

PostgreSQL is the production matching authority. Its case handling depends on its configured locale/collation. SQLite's default LIKE/LOWER is mainly ASCII case-insensitive; SQLite test success does not establish multilingual parity. A separate PHP Unicode regex or case-fold operation must not silently redefine eligibility when generating parts.

Implement the match-part helper with multibyte-safe operations and explicitly verify that it finds the same original-text occurrences as the PostgreSQL predicate. Test both positive and negative cases independently for **each field**, not just overall result eligibility. In particular, a title match must not conceal a falsely marked, nonmatching transcript: PHP Unicode matching can treat `s` and long S (`ſ`) as equivalent, while database behavior must be established in its actual locale. Verify that marked-title, marked-description, and excerpt-presence decisions each agree with that field's SQL predicate.

No accent stripping or canonical Unicode normalization is promised: composed and decomposed sequences remain distinct unless already stored identically. Add real PostgreSQL examples for accented letters, non-Latin text, Turkish I, sharp S, and long S before declaring the production contract complete. If matching and part extraction disagree in either direction, stop and align them before merge; do not ship a returned transcript match with no marked occurrence, suppress a legitimate match silently, or fabricate an excerpt on a metadata-eligible result. This is an explicit implementation/release gate, not a claim that universal Unicode parity has already been solved.

### 4.3 Excerpt construction

Use the first actual match in the **persisted body**, not the beginning of every transcript and not a separately fetched caption cue. Build approximately 360 Unicode codepoints of source text around that occurrence, with leading/trailing context where available. The current 255-character query limit must fit without cutting the matching phrase. Clip context at string boundaries; avoid splitting UTF-8 characters. Prefer nearby whitespace boundaries only if doing so preserves the complete match and length bound.

Mark every non-overlapping occurrence visible in the chosen excerpt. Repeated matches outside it do not create additional cards or excerpt windows. Set truncation booleans when source text was omitted; render ellipses separately so they are not falsely treated as matching source text. Preserve original casing and punctuation in all parts.

Build eligibility and snippets from a consistent transcript version. At minimum, after eager loading, recheck all three fields with the agreed matcher before emitting a card: a concurrent re-derive can change the body between the selection and eager-load queries. If only the old transcript matched and the current projection no longer does, omit that stale result rather than emitting an unexplained card. Prefer a single select/join snapshot if that simplifies consistency without changing normal resource fields. A metadata match remains eligible even if the transcript disappeared or changed; excerpt is then null.

### 4.4 Transcript availability and freshness

- No transcript row, empty body, or initial processing/failure: title/description can still match; no content excerpt.
- Existing projection during regeneration or disabled automatic captions: continue using that projection as today.
- Include both `source='whisper'` and `source='edited'`. Speaker corrections should appear after the existing asynchronous re-derive and revision convergence.
- Do not enqueue Whisper, read SeaweedFS, alter caption revisions, or search annotation/essay tables.

## 5. Frontend design

Retain the current page/card/link structure and 300 ms debounce. Change the copy to name titles, descriptions, and available speech transcripts; a label such as “Search text” is more accurate than transcript-only instructions. Update tests/locators if the label changes. Validate the trimmed query's length in Unicode codepoints, for example with `Array.from(value).length`, against the server's 255-character limit. Overlength input should hide old results, show an associated inline validation message, and issue no search request until valid. Do not silently truncate or split surrogate pairs. Native HTML `maxLength={255}` alone is not equivalent: it counts UTF-16 code units while installed Laravel validation uses `mb_strlen` codepoints.

Add a small `HighlightedText` component only if useful for the three repeated fields. It accepts the structured parts and renders `<mark>` with an explicit yellow background and dark text in both themes. Use existing Tailwind/theme conventions, visible link focus, wrapping, and overflow handling. Do not truncate/clamp the title or description in a way that hides the matching text. The description stays absent when missing/empty.

Label the optional body preview “Transcript excerpt”. Render that block only when `search_match.transcript_excerpt` exists; there is no “no transcript” placeholder on metadata-only cards. Add ellipses according to the truncation flags and preserve the full marked phrase at narrow widths.

For async state:

1. Read RTK Query `currentData` for the effective debounced argument, not retained previous-argument `data`.
2. Show cards only when trimmed input equals the nonempty effective debounced query, there is current-query data, and that query is not in error. Hide old cards immediately when input is changed or cleared, including during the debounce interval.
3. Tie loading, error, count, and empty messages to that same query identity. Do not show “no matches” while a fetch is pending. Keep current-query cached data usable during a same-query background refetch if desired, with a searching indicator; hide cards when that query fails.
4. Preserve `skipToken` for blank text and `refetchOnMountOrArgChange`. Keep caption-edit invalidation after projection convergence.
5. Use a small polite status region for progress/count/empty messages and the existing alert behavior for errors. Keep results as a list of ordinary links; do not announce every card as a live region.

Metadata mutations currently invalidate `speechApi` tags, not this slice's `Search` tag. Retain the existing remount-refetch guarantee for this task. Do not promise live refresh across tabs or add unrelated cross-slice cache refactoring.

## 6. Schema, performance, and consequences

No new table, column, migration, backfill, transcription pass, queue worker, search engine, or package is required. Preserve existing tsvector/GIN schema and schema-verification checks as historical infrastructure.

However, arbitrary substring predicates do **not** gain acceleration from the existing English tsvector GIN index. The owner index and unique transcript lookup still limit the search scope. Database filtering must precede materializing transcript bodies, and no complete transcript should be serialized. Returning all matches retains the existing contract but can increase server memory because bodies are now needed for excerpts.

Measure a representative owner library on disposable PostgreSQL with query-count assertions and `EXPLAIN (ANALYZE, BUFFERS)` before claiming scale. Do not use a tiny fixture's sequential scan as a performance verdict or assert a speculative user-count threshold. If measurement demonstrates unacceptable cost, propose a separate pagination/trigram-index migration with explicit review; do not silently add `pg_trgm`, remove GIN, or cap results during implementation.

## 7. File-scoped implementation sequence

Future execution should assign exclusive ownership and run dependencies in order. Proposed new files are names to create, not claims that those files already exist.

| Task | Files | Dependency and work |
|---|---|---|
| A — matching, API, and contract | `api/app/Http/Controllers/Api/TranscriptController.php`; `api/app/Http/Requests/Transcript/SearchTranscriptsRequest.php`; new `api/app/Services/Search/SpeechSearch.php`, `SearchTextMatcher.php`; new `api/app/Http/Resources/SpeechSearchResource.php`; `api/tests/Feature/Captions/TranscriptControllerTest.php`; new unit tests for matcher/excerpt | First settle literal matching/production case behavior and additive JSON shape. Keep original transcript read endpoint and general speech resource unchanged. Trim/validate server-side and reject blank/overlength input. Add regression tests before behavior changes. |
| B — client contract and cards | `web/src/features/transcript/types.ts`, `transcriptApi.ts`, `transcriptApi.test.tsx`; `web/src/routes/Search.tsx`, `Search.test.tsx`; proposed `web/src/components/search/HighlightedText.tsx` and test | After A's contract is fixed; render safe parts, conditional excerpt, copy, yellow styles, current-query async guards, accessible states. No general Speech type or routing change. |
| C — real PostgreSQL/browser coverage | `api/database/seeders/E2ECaptionsSeeder.php`; `api/tests/Feature/Captions/E2ECaptionsSeederTest.php`; `web/tests/fixtures.ts`; `web/tests/captions.spec.ts` | After A/B. Add dedicated search controls using unused, verified fixture IDs. Preserve existing cue/edit/search controls and Scenario D; extend it or add scenarios in the same already-selected spec. Test actual API metadata and rendered marks. No development seeding. |
| D — documentation and review | This plan's execution record; narrow current-status note in `STEP-09-FROZEN-CONTRACT.md` | After implementation. Record the approved search contract superseding that document's transcript-only FTS statement while preserving its history. Update touched source comments that claim the old search semantics. Review actual diff against plan and run relevant suites. |

No changes are expected to migrations, Whisper/FFmpeg workers, caption derivation, player, commentary, permissions, application routes, auth, Docker/nginx, or CI selection. `captions.spec.ts` is already selected in CI. If a new spec is chosen instead, explicitly review its CI inclusion before changing that additional file.

## 8. Validation and acceptance checklist

### Backend and matcher

- Title-only, description-only, transcript-only, and all-three matches; no duplicate speech; normal resource fields preserved.
- Metadata match with no transcript, null/empty description, nonmatching/empty transcript: null excerpt and correct eligible result.
- Separate foreign-owner and soft-deleted controls for **each OR arm**; reviewed-but-not-owned excluded; anonymous requests remain denied. Tests must not accidentally let transcript matches conceal a faulty title/description scope.
- Contiguous phrase versus separated/reversed words; substring inside a word; case differences; stopwords; outer trim and internal whitespace; query length/blank validation.
- Literal `%`, `_`, `!`, backslash, quotes, regex punctuation, HTML-looking text, and marker-like strings; no SQL interpolation and no executable markup.
- First/middle/last occurrence, repeated occurrences, maximum-length query, text shorter than excerpt, long unbroken text, multibyte boundaries, and retained full phrase. Null excerpt iff body does not match; no full body/segments response leak.
- Cross-cue phrase, `edited` source, retained disabled/previous projection, and changed/deleted projection between selection and serialization.
- Query count remains bounded with increasing result count; no per-card transcript query. Retain newest-first order and deterministic ties.

### Frontend

- Render title and nonempty description, correctly marked only where matching; transcript-only result has a marked excerpt; metadata-only result has no excerpt block.
- Missing additive metadata during rolling deployment falls back safely to plain metadata.
- XSS-looking strings render literally with no injected elements; explicit yellow/dark mark contrast in light/dark themes; long text wraps and title link accessible name remains intact.
- Delayed older responses, new typing, clear, whitespace-only/overlength input, error after prior success, pending query, and same-query refetch cannot expose stale cards or mislabel their highlights. Include 255 versus 256 codepoint cases with supplementary characters and no split surrogate pairs. Preserve debounce, URI encoding, remount refetch, and projection-convergence behavior.
- Ordinary keyboard navigation/link activation, visible focus, loading/error/empty messages, desktop and narrow viewport.

### Real PostgreSQL and browser

- Extend seeded controls so a title-only match and description-only match each exist without a transcript, plus actual content-only, multi-field, nonmatch, foreign-owner, and deletion controls. Use distinct phrases so one fixture cannot satisfy the wrong branch accidentally.
- Assert the actual JSON contract and visible `<mark>` text against PostgreSQL, not only a mocked fetch or SQLite. Exercise punctuation/wildcard escaping, phrases, stopwords, and production case examples; explicitly test Unicode forms and case-fold edge cases rather than claiming universal cross-driver equivalence. Verify field-level negatives as well as positives, including a title-eligible/body-negative card, so an overbroad application matcher cannot fabricate an excerpt.
- Preserve Scenario D's pre-warmed no-match → real caption PUT → revision convergence → return to search → matching corrected excerpt/mark. Ensure the old phrase disappears after the projection actually changes.
- Preserve `scripts/verify-postgres-caption-schema.sh`: it checks column/index catalog shape and does not prove this endpoint's new semantics or performance.

Suggested commands, **for future implementation validation**, from their respective project directories:

```sh
# api/: explicit isolated SQLite configuration, never inherited dev DB/cache
APP_ENV=testing CACHE_STORE=array SESSION_DRIVER=array DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL='' QUEUE_CONNECTION=sync PULSE_ENABLED=false TELESCOPE_ENABLED=false NIGHTWATCH_ENABLED=false php -d memory_limit=512M vendor/bin/pest --compact tests/Feature/Captions tests/Unit

# api/: existing CI formatting/static-analysis gates, also in isolated env
APP_ENV=testing CACHE_STORE=array SESSION_DRIVER=array DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL='' QUEUE_CONNECTION=sync PULSE_ENABLED=false TELESCOPE_ENABLED=false NIGHTWATCH_ENABLED=false vendor/bin/pint --test
APP_ENV=testing CACHE_STORE=array SESSION_DRIVER=array DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL='' QUEUE_CONNECTION=sync PULSE_ENABLED=false TELESCOPE_ENABLED=false NIGHTWATCH_ENABLED=false php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G

# web/
npm test -- --run src/routes/Search.test.tsx src/features/transcript/transcriptApi.test.tsx
npm run typecheck
npm run lint
npm run build

# web/: dedicated disposable E2E stack with actual PostgreSQL/caption workers
npx playwright test tests/captions.spec.ts --project=chromium
```

Include new matcher/renderer tests and appropriate full backend/frontend suites after focused checks. The existing `captions.spec.ts:33` deliberately skips every non-Chromium project because its serial scenarios mutate shared fixtures; preserve that guard. Running that file with `--project=webkit` produces skips, not secondary-browser evidence. Chromium is the required automated real-stack lane for this plan. Record any separate manual secondary-browser search checks as manual evidence; do not claim automated WebKit coverage or remove the mutation guard.

Browser tests that edit captions require the existing caption worker/convergence infrastructure, not a synchronous test-only substitute. Run mutations/seeding only on disposable infrastructure. Existing fixed E2E ports may be owned by development: do not stop/reseed development, run destructive fresh modes, or invent unsupported origin overrides to make tests pass. Report blocked checks accurately or use a reviewed isolated test setup.

## 9. Rollout, rollback, and completion boundary

Deploy backend and frontend together through the normal process. There is no data migration. Ordinary title/description matching becomes available even for speeches whose captions are unavailable; generated or corrected transcripts become searchable through their existing lifecycle.

Rollback consists of restoring the previous backend/frontend artifacts together. No data restore, index deletion, media cleanup, transcription rerun, or role changes are needed. Additive response fields are safe for older clients; the new frontend fallback tolerates their temporary absence.

Implementation is complete only when eligibility, optional excerpts, visible highlights, owner isolation, async state, and actual PostgreSQL behavior all pass their acceptance checks. A plan/source review alone is not runtime proof. The original planning task changed only this Markdown file; the subsequently authorized implementation is recorded below.

## 10. Adversarial review record

Independent agent `/root/search_plan_adversarial` reviewed revision 1 against the current source without editing files or accessing the database/browser. It found the owner scope, projection lifecycle, additive response shape, safe rendering, concurrency safeguard, and current-query UI guards sound, and reported four actionable findings. The coordinator checked the cited code and incorporated all four in revision 2:

| Finding | Verified evidence | Correction |
|---|---|---|
| Medium: WebKit command would produce skips, not proof. | `web/tests/captions.spec.ts:33–35` explicitly skips non-Chromium; CI documents that boundary. | Removed the misleading command, retained the shared-fixture mutation guard, and documented Chromium as the required automated lane with secondary-browser checks reported separately. |
| Medium: backend formatting/static-analysis gates omitted. | `.github/workflows/ci.yml:79–85` and `api/composer.json` run Pint and Larastan. | Added the existing read-only formatting/static-analysis commands with isolated environment settings. |
| Medium: Unicode gate needed field-level negative controls. | Installed PHP source-only probe confirms `/s/iu` and `mb_stripos('ſ', 's')` can find long S; SQL behavior depends on PostgreSQL locale. | Expanded the blocking gate and integration tests to both directions and every field, specifically metadata-eligible/body-negative cards. No claim of already solved Unicode parity. |
| Low: HTML and server length units differ. | Installed Laravel `ValidatesAttributes.php:2825` uses `mb_strlen`; HTML input length is measured in UTF-16 units. | Specified codepoint-aware client validation, no request for invalid length, and supplementary-character boundary tests. |

The reviewer completed its read-only recheck of revision 2 and confirmed all four findings were addressed, with no remaining blocking contradiction. It explicitly confirmed that production Unicode matching parity remains an implementation gate, not a solved-runtime claim.

Coordinating final validation of the original planning task checked source references, document structure/whitespace, the current commit, and worktree scope. Only this new Markdown file changed in that planning task. No application behavior, migrations, fixtures, containers, browser state, or development data changed then, and implementation tests had not yet been run. This historical record does not describe the subsequently authorized work below.

## 11. Authorized implementation and validation record

The user subsequently authorized implementation of this plan without a commit. Work is on `feat/speech-search-excerpts`, started from `82a612c`; the search changes remain unstaged and uncommitted. An external commit, `b5579c2`, appeared during validation and changes only `scripts/verify-postgres-last-admin-lock.sh`; none of the implementation workers or coordinator staged or committed it. It was preserved without modification. The coordinator assigned one worker per task with exclusive file ownership: B started once A's contract was fixed, C started after A/B finished, and D followed C. This settled contract and fixture dependencies before dependent edits without claiming all A validation had finished before B began. No worker reported a source/plan mismatch.

| Task and ownership | Implemented result | Focused validation reported by the responsible worker |
|---|---|---|
| A — backend controller/request, search services/resource, controller and matcher tests listed in §7 | Owner-scoped title/description/transcript literal matching; additive structured match metadata; bounded excerpts; server trim/validation; consistent joined transcript snapshot. General speech resource and transcript-read behavior remain unchanged. | PostgreSQL: 75 passed, 309 assertions. Isolated SQLite: 142 passed, 34 skipped, 509 assertions; skips include 33 PostgreSQL-specific cases and the existing real-Whisper smoke test. Scoped Pint passed. Full Larastan completed with exit 0 using direct single-process `--debug`; the default sandbox parallel runner exited 1 without a code diagnostic, so that attempt is not reported as a successful analysis run. |
| B — search-specific frontend types/API/tests, Search page/tests, new highlight component/tests listed in §7 | Safe React text/mark rendering, yellow highlights, optional transcript excerpts, metadata fallback, current-query async guards, accessible statuses, and codepoint-aware length validation. | 16 focused frontend tests passed; typecheck and lint passed. |
| C — E2E captions seeder/tests and existing browser fixtures/captions spec listed in §7 | Dedicated title/description/content/multi-field, owner-isolation, deletion and literal-match controls; retained real caption-edit/convergence scenarios and Chromium mutation guard. | Seeder coverage: 12 passed, 159 assertions. Frontend lint and typecheck passed. Actual final Chromium runtime passed all 13 tests: 5 setup tests and 8 caption scenarios A–H; see the review record below. |
| D — this execution record and the narrow current-status note in `STEP-09-FROZEN-CONTRACT.md` | Documents the implemented search contract while preserving the original frozen-contract history. | Documentation scope and whitespace review completed; independent code review and full validation results are recorded below. |

### Matching authority and consistency

The implemented predicate uses bound, explicitly escaped `LOWER(field) LIKE LOWER(query)` comparisons. The same SQL statement returns the original field text, SQL-lowered text, normalized needle, and each field's SQL eligibility flag from one joined snapshot. The PHP matcher uses positions in those database-lowered strings, preserves original displayed text, and checks each field's emitted match decision against its SQL flag. It does not introduce PHP Unicode case folding. This makes a title-eligible/body-negative result an explicit consistency check instead of allowing title eligibility to conceal a fabricated transcript excerpt.

The disposable PostgreSQL 17 instance uses `en_US.utf8`. Production-case examples and field-level negative controls were tested there. A separate probe of every valid non-NUL Unicode scalar found no lowercase mapping that expands codepoint length for that instance. These are locale-specific findings, not a promise of universal case-fold equivalence: Greek final sigma and other locale-sensitive cases follow the database's lowercase behavior. The match helper fails explicitly if a different database locale violates position preservation.

No schema, index, result cap, or general visibility change was introduced. The existing full-text GIN index is retained and does not accelerate the new literal-substring predicate.

### Disposable runtime and performance evidence

Runtime validation used the dedicated Compose project `speechcoach-search-9arkpxbu`, with its own network and PostgreSQL/SeaweedFS volumes. Temporary configuration and evidence live under `/private/tmp/speech-search-review.9arkpxbu`. PostgreSQL used only loopback port 19544; the isolated web endpoint used 19444. A loopback proxy on 19981 preserved the existing application/API/media origins. Branch images were built for this isolated project; this implementation did not restart or reseed the development stack.

The repository's existing browser harness remains unchanged. A temporary fail-closed PATH wrapper maps only the exact existing captions fixture-reset command to this dedicated project and its override, rejecting other Docker commands. This limits fixture mutations to disposable infrastructure rather than changing the checked-in harness or development origins.

A representative measurement created 500 owned and 500 other-owner speeches, each with approximately 15,000 transcript characters, only on disposable PostgreSQL. Synthetic measurement data was rolled back. Three service runs with 25 matches took 160.48 / 71.45 / 63.28 ms, using three queries each; no-match runs took 48.84 / 50.11 / 48.09 ms, using one query each. Actual `EXPLAIN (ANALYZE, BUFFERS)` execution was 48.54 ms for the matching query and 45.23 ms for the miss. These measurements verify the observed query shape and bounded query count for that sample; they are not a capacity guarantee or a universal user-count threshold. Raw measurement evidence is in the temporary `performance.json` artifact.

### Independent review, repairs, and final validation

After all implementation workers finished, the requested read-only reviewer compared the actual changes with the plan, checked the main login, and ran the applicable suites. It confirmed all plan steps and reported no remaining defect after these two repairs, each completed by the original file owner:

1. Full Larastan identified two errors in the positional fixture tuple loop in `E2ECaptionsSeeder.php`. Replacing that loop with explicit fixture calls preserved every fixture ID, content value, owner and deletion control. The seeder tests again passed (12 tests, 159 assertions), and the reviewer independently reran full Larastan with zero errors and full-repository Pint successfully.
2. The initial Chromium run passed 13/13, but a fresh rebuilt-image reviewer run exposed Scenario D proceeding while Notes remained selected and the video metadata was not yet available (8 passed, 1 failed, 4 serial tests not run). The fixture/browser worker added the existing `waitForVideo` helper's `HAVE_METADATA` readiness check before the normal Transcript-tab click, plus explicit selected-tab and visible-panel assertions. No retries, forced clicks, sleeps, cache teardown, or application changes were added. The reviewer then reran the entire Chromium lane: **13/13 passed in 21.9 seconds, exit 0**.

The final Chromium lane includes three real shared-login sessions, actual API match JSON and rendered yellow marks, and Scenario D's real caption PUT, asynchronous projection revision convergence, cache refresh and corrected search excerpt. A separate actual-API check of the cross-cue phrase `notes quarterly` returned only fixture 9407 with the marked excerpt. The failed report (`reviewer-playwright-final.json`) and passing report (`reviewer-playwright-final-passed.json`) are retained in the temporary evidence directory; the initial failure is not hidden by the final passing result.

| Final validation | Result and boundary |
|---|---|
| Full backend suite, isolated SQLite | **948 passed, 35 skipped, 4,973 assertions.** The skips are 33 PostgreSQL-specific cases plus two existing real-binary smoke tests. PostgreSQL-specific search behavior was separately exercised against PostgreSQL (75 passed, 309 assertions); skipped real-binary smoke tests are not claimed as run. |
| Full frontend suite | **636/636 passed across 93 files.** |
| Real-stack Chromium | **13/13 passed**, including actual shared login and real caption-edit/search convergence. |
| Static/build checks | Typecheck, lint, production build, full Larastan and full-repository Pint passed. Lint retains five existing warnings; the build retains its existing bundle-size warning. |
| Final plan/code review | Every planned step confirmed, no remaining defect reported, and no auth, schema, permissions, checked-in harness, or CI-selection change introduced. |

No secondary-browser coverage is claimed; the existing non-Chromium skip guard remains intact. Database case behavior remains locale-specific as documented above, and the sample performance measurements do not establish unrestricted scale. This implementation did not deploy, restart or reseed the development stack. External activity advanced HEAD and development-container uptimes during validation, so this record does not claim the entire shared environment was globally unchanged.

The original three generated browser-auth snapshots were restored and verified byte-for-byte, the temporary loopback proxy was terminated, and all six containers belonging to the dedicated test project were stopped and verified stopped. Disposable volumes and validation evidence are retained. Development services were observed running afterward; no development containers or user data were removed by this implementation. The search implementation remains available for review in the worktree without a commit.
