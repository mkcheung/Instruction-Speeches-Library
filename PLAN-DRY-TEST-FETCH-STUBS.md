# Plan: one shared fetch-stub toolkit for the web unit tests

**Status:** rev 2, 2026-11-18. **Validated on a scratch copy of `b2c5e8e`; not implemented.**
**Scope:** `web/src` test files only, plus one new test helper module `web/src/test/fetchStub.ts`. No production code. No test is added, removed, renamed or reworded, except for the optional helper tests in §3.
**Baseline:** `development` at `b2c5e8e`: `tsc -b` OK, `eslint .` 0 errors / 5 warnings, `vitest run` 145 files / 1603 tests.

## Goal

37 test files that stub `fetch` each define their own copies of up to four tiny helpers: 34 `jsonResponse`, 34 `urlOf`, 16 `methodOf` and 8 `bodyOf`. That is 92 copies; the conversion deletes 91 of them (SpeechEditDialog's different `bodyOf` stays). Afterwards one module, `web/src/test/fetchStub.ts`, owns them, next to the existing `renderWithProviders.tsx`, `voiceAudio.ts` and `voiceFixtures.ts`.

## What the review established

Every definition was extracted and grouped by its whitespace-normalized body:

| Helper | Copies | Distinct bodies | Verdict |
|---|---|---|---|
| `jsonResponse` | 34 | 3: 28× `(body: unknown, status = 200)`; 3× the same with a trailing comma (`Home`, `Onboarding`, `PublicProfile`); 3× `(body: unknown, status: number)` with status required (`lib/baseQuery.test.ts`, `routes/Register.test.tsx`, `routes/Login.test.tsx`) | One behavior. Where `status` is required, TypeScript already forces every call to pass it, so a default of `200` changes nothing. |
| `urlOf` | 34 | 2: 32 `function`s and 2 identical `const` arrows (`components/auth/UnauthenticatedRedirect.test.tsx:77`, `components/layout/ConnectionRequestsBell.test.tsx:16`) | One behavior. |
| `methodOf` | 16 | **2 different precedence rules.** 10 are Request-first: `(input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()`. 6 are init-first: `(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()` | They differ only when one call passes both a `Request` and an `init` whose `method` disagrees. §2 proves that never happens in this suite before merging. |
| `bodyOf` | 8 | 2: 7× "parse a `Request` body as JSON, `{}` otherwise"; 1× `components/speech/SpeechEditDialog.test.tsx:22`, a different contract (returns `unknown`, reads text then `JSON.parse`, supports `init.body`) | Share the 7. SpeechEditDialog keeps its own. |

Which `methodOf` copies use which rule:
- **Request-first:** `account/DeleteAccountDialog`, `account/ExportSection`, `essay/EssayEditorPanel`, `report/ReportDialog`, `review/ReviewerRoster`, `speech/SpeechDeleteDialog`, `speech/SpeechEditDialog`, `features/review/crossSliceInvalidation`, `hooks/useEssayEditor`, `routes/Dashboard`.
- **init-first:** `caption/CaptionEditor`, `caption/CaptionSettingsToggle`, `features/caption/captionApi`, `features/coachApplication/coachApplicationApi`, `hooks/useCaptionEditor`, `routes/BecomeACoach`.

The 37 files, and which helpers each defines:

```
components/account/DeleteAccountDialog.test.tsx         jsonResponse urlOf methodOf
components/account/ExportSection.test.tsx               jsonResponse urlOf methodOf
components/annotation/AnnotationList.test.tsx           jsonResponse urlOf bodyOf
components/auth/UnauthenticatedRedirect.test.tsx        urlOf
components/caption/CaptionEditor.test.tsx               jsonResponse urlOf methodOf bodyOf
components/caption/CaptionSettingsToggle.test.tsx       jsonResponse urlOf methodOf bodyOf
components/caption/TranscriptPanel.test.tsx             jsonResponse urlOf
components/essay/EssayEditorPanel.test.tsx              jsonResponse urlOf methodOf
components/essay/EssayReadOnlyPanel.test.tsx            jsonResponse urlOf
components/layout/ConnectionRequestsBell.test.tsx       urlOf
components/layout/NotificationBell.test.tsx             jsonResponse urlOf
components/report/ReportDialog.test.tsx                 jsonResponse urlOf methodOf bodyOf
components/review/ReviewerRoster.test.tsx               jsonResponse urlOf methodOf
components/speech/SpeechDeleteDialog.test.tsx           urlOf methodOf
components/speech/SpeechEditDialog.test.tsx             jsonResponse urlOf methodOf  (+ its own different bodyOf: keep)
components/speech/StatusBadge.test.tsx                  jsonResponse urlOf
features/caption/captionApi.test.tsx                    jsonResponse urlOf methodOf bodyOf
features/coachApplication/coachApplicationApi.test.tsx  jsonResponse urlOf methodOf
features/review/crossSliceInvalidation.test.ts          jsonResponse urlOf methodOf
features/transcript/transcriptApi.test.tsx              jsonResponse urlOf
hooks/useCaptionEditor.test.tsx                         jsonResponse urlOf methodOf bodyOf
hooks/useCaptionsJob.test.tsx                           jsonResponse urlOf
hooks/useEssayEditor.test.tsx                           jsonResponse urlOf methodOf bodyOf
hooks/useExportJob.test.tsx                             jsonResponse urlOf
lib/baseQuery.test.ts                                   jsonResponse
routes/BecomeACoach.test.tsx                            jsonResponse urlOf methodOf
routes/Dashboard.test.tsx                               jsonResponse urlOf methodOf
routes/Home.test.tsx                                    jsonResponse urlOf
routes/Login.test.tsx                                   jsonResponse urlOf
routes/MySpeeches.test.tsx                              jsonResponse urlOf
routes/Onboarding.test.tsx                              jsonResponse urlOf
routes/PublicProfile.test.tsx                           jsonResponse urlOf
routes/Register.test.tsx                                jsonResponse urlOf
routes/ReviewerDirectory.test.tsx                       jsonResponse
routes/Search.test.tsx                                  jsonResponse
routes/SpeechCreate.test.tsx                            jsonResponse urlOf
routes/SpeechWatch.test.tsx                             jsonResponse urlOf
```

**Constraints, checked:**
- **No `vi.mock` or `vi.hoisted` factory references any of the four helpers** (7 such calls, in `EssayEditorPanel`, `SpeechCreate` and `SpeechWatch`). So a plain import works; no hoisting issue.
- **`src/test` is type-checked under `tsconfig.app.json`,** with `noUnusedLocals` and `verbatimModuleSyntax`. So each file imports exactly the names it uses.
- **It's a `.ts` file,** so the react-refresh lint rule doesn't apply.

## Ground rules

- **Tests only.** Don't edit production files.
- **Every test body, title and assertion stays byte-identical.** Only helper definitions are deleted and imports added.
- **Keep the helper names.** Existing call sites don't change.
- **The probe in §2 is temporary.** It never lands.

## §1 `web/src/test/fetchStub.ts`

```ts
/** Helpers for tests that replace `fetch` with a stub. fetchBaseQuery calls `fetch(request)` with a pre-built
 * Request; direct calls pass `(url, init)`. */

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

export function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase()
}

/** A Request's JSON body, or `{}` when there is none or it isn't JSON. */
export async function bodyOf(input: RequestInfo | URL): Promise<Record<string, unknown>> {
  if (!(input instanceof Request)) return {}
  try {
    return (await input.clone().json()) as Record<string, unknown>
  } catch {
    return {}
  }
}
```

`methodOf` uses the Request-first rule (10 of 16 copies). §2 must show it agrees with the init-first rule on every call in the suite.

## §2 Equivalence probe for `methodOf` (scratch only; never lands)

1. Before converting any file, temporarily make the shared `methodOf` compute both rules. When they differ, log the URL with `console.error` (Vitest prints it in a `stderr |` block), then throw `Error(\`methodOf disagreement: ${requestFirst} vs ${initFirst}\`)`.
2. Convert the 16 `methodOf` files completely: all their helpers, per §3 steps 2–3, so SpeechEditDialog keeps its `bodyOf`. Run the full suite as `npx vitest run --reporter=default`, and grep its output for `methodOf disagreement`.
3. **Pass bar:** no `methodOf disagreement` line in that output, and the same pass/fail counts as the baseline.
   - **The log is the detector, not the throw.** fetchBaseQuery catches whatever the stub throws and returns a `FETCH_ERROR`, so a test that only checks that a call was made, or that expects a failed request, stays green. Measured with a variant that throws on every call: 5 of the 32 tests that reach `methodOf` stay green (the two `ReviewerRoster` tests that reach it, `Dashboard`'s Withdraw and Abandon, and `useCaptionEditor`'s "offline on a failed save").
   - **Pass `--reporter=default` explicitly.** Vitest 4.1 run inside an AI-agent session (`CLAUDECODE` or `AI_AGENT` set) with no `--reporter` uses its `agent` reporter (`silent: 'passed-only'`), which drops console output from passing tests. With the always-throw variant, `ReviewerRoster` is 6/6 green and prints no log line without the flag, and 2 with it.
   - If any disagreement appears, stop. Keep those files' local init-first copies and record which ones in the plan.
4. Restore the plain `methodOf` from §1.

**Result (rev 2, scratch copy of `b2c5e8e`):** no disagreement; 145 files / 1603 tests, every per-test status identical to the baseline. A call-logging variant shows why the split is unobservable here: `methodOf` runs 52 times, in all 16 files (32 tests). 50 calls are `(Request)` with no `init`, which is fetchBaseQuery's `fetchFn(request)`, and 2 are `(string, init)`, useEssayEditor's keepalive PUT. A `Request` together with an `init.method`, the only shape where the rules differ, never occurs. Production code never makes that call either: `lib/csrf.ts`, `hooks/useEssayEditor.ts` and the spikes pass string URLs.

## §3 Conversion, per file

1. Add `web/src/test/fetchStub.ts` (§1).
2. In each of the 37 files:
   - delete its local definitions of the four helpers, each with the blank line after it and any JSDoc block on top of it. Three `methodOf` copies carry one (CaptionEditor, captionApi, useCaptionEditor); left behind, it would describe the next declaration;
   - add `import { … } from '@/test/fetchStub'` listing only the helpers the file used;
   - place the import with the file's other `@/test/...` imports. Every one of the 37 has at least one; rev 2 put it right after the last.
3. **SpeechEditDialog exception.** `components/speech/SpeechEditDialog.test.tsx` keeps its own `bodyOf`. It imports only `jsonResponse`, `urlOf` and `methodOf`.
4. **The two `const urlOf` arrows** (UnauthenticatedRedirect, ConnectionRequestsBell) are deleted and imported like the rest.
5. **Optional:** `web/src/test/fetchStub.test.ts` with a few cases:
   - `jsonResponse` defaults to 200 and sets `Content-Type`;
   - `methodOf` with a `Request`, with `(url, init)`, and with neither;
   - `bodyOf` on JSON, on non-JSON and on a string input.

   If added, the expected total grows by exactly that file's test count. One test per listed case is 7 (validated: 1610 in all). The list has no `urlOf` case and no non-default `status`, so of the §4 mutations only the `methodOf` and `bodyOf` ones reach it.

## §4 Verification (before any edit, after the probe, after the conversion)

- **CI's commands, from `web/`:** `npx tsc -b && npx eslint . && npx vitest run`. `tsc --noEmit` is a no-op here, so don't use it.
  - Expected after §3: tsc OK, eslint 0 errors / 5 warnings, vitest 145 files / 1603 tests.
  - With the optional helper test, it's 146 files and 1603 + N tests: 146 / 1610 with the 7 listed cases (validated).
- **Per-file counts.** Before and after, run `npx vitest run <the 37 files> --reporter=json --outputFile=<file>` once, and compare each file's test count and each test's full name and status. They must be identical (they were). Baseline, 386 tests: DeleteAccountDialog 5, ExportSection 15, AnnotationList 3, UnauthenticatedRedirect 27, CaptionEditor 6, CaptionSettingsToggle 5, TranscriptPanel 2, EssayEditorPanel 4, EssayReadOnlyPanel 4, ConnectionRequestsBell 13, NotificationBell 12, ReportDialog 3, ReviewerRoster 6, SpeechDeleteDialog 4, SpeechEditDialog 3, StatusBadge 9, captionApi 3, coachApplicationApi 3, crossSliceInvalidation 2, transcriptApi 3, useCaptionEditor 8, useCaptionsJob 2, useEssayEditor 16, useExportJob 5, baseQuery 5, BecomeACoach 6, Dashboard 18, Home 9, Login 20, MySpeeches 5, Onboarding 4, PublicProfile 39, Register 3, ReviewerDirectory 6, Search 12, SpeechCreate 3, SpeechWatch 93.
- **Greps after the conversion** (from `web/`; quote the `--include` glob, which zsh otherwise expands and rejects):
  - `grep -rnE "function (jsonResponse|urlOf|methodOf)\b|const urlOf =" src --include='*.test.*'` prints nothing. Keep the group: ungrouped, `function jsonResponse|urlOf|methodOf` matches every call site (225 lines after the conversion);
  - `grep -rnE "function bodyOf\b" src` prints exactly `src/test/fetchStub.ts` and `src/components/speech/SpeechEditDialog.test.tsx`.
- **Mutation checks** (prove the files really use the shared module; apply, confirm red, revert):
  - `jsonResponse` ignores `status` and always uses 200: the status-dependent tests go red (e.g. `lib/baseQuery.test.ts` 419/401 handling, `routes/Login.test.tsx` error states). Validated: 16 files / 32 tests, including baseQuery 3/5 and Login 2/20.
  - `urlOf` returns `''`: broad red across the converted files. Validated: 34 files / 209 tests, exactly the 34 `urlOf` importers.
  - `methodOf` always returns `'GET'`: the method-routing tests go red (e.g. `ReportDialog`, `captionApi`). Validated: 14 of the 16 importers, 26 tests, plus 2/7 in the optional helper test. `ReviewerRoster` and `Dashboard` stay green.
  - `bodyOf` returns `{}`: the body assertions go red (e.g. `AnnotationList`, `captionApi`). Validated: 6 of the 7 importers, 7 tests, plus 1/7 in the helper test. `CaptionSettingsToggle` stays green.
  - A file that stays green under a mutation still provably uses the module: with its local copy gone, dropping the import is a `tsc -b` "Cannot find name" error (checked on `ReviewerRoster`).
- **Host load:** under a load average above about 20, `SpeechWatchOwnerTimeline.test.tsx` can time out. Rerun it alone before calling it a regression.

## §5 Out of scope

- **Local Provider wrappers.** 13 test files define their own `function wrapper(...)` around `createTestStore()`. That's a separate follow-up; `renderWithProviders` already exists.
- **Per-file routing tables** inside each `fetch` stub. They differ per test, on purpose.
- **E2E specs** (`web/tests`).
- **Same-body helpers under other names.** "Keep the helper names" leaves them alone: copies of `jsonResponse` named `json` in 11 files (UnauthenticatedRedirect, ConnectionRequestsBell, UserMenu, ConnectionsRail, FriendPersonCard, ProfileConnectionAction, connectionApi, connectionSession, profileApi, ProfileFriends, SpeechWatchOwnerTimeline) and `response` in 2 (useAnnotationEditor, ProfileHome), plus `jsonBodyOf` in coachApplicationApi, identical to the shared `bodyOf`. Moving them to aliased imports (`import { jsonResponse as json }`) is a separate follow-up.

## §6 Review log

- rev 1 (2026-11-18): drafted from an extraction of every helper definition grouped by normalized body, a check that no `vi.mock`/`vi.hoisted` factory references a helper, and the `methodOf` precedence split.
- rev 2 (2026-11-18): applied as written to a scratch copy of `b2c5e8e`. The trio at each checkpoint: baseline tsc OK, eslint 0/5, 145 / 1603; after the probe, the same; after §3 with the optional test, tsc OK, eslint 0/5 (the same 5 warnings), 146 / 1610. The 37 files' per-file counts (386 tests) and every test's name and status were identical before and after. All four mutations went red as predicted. Findings and fixes:
  - **MAJOR, §2: a throw is not a red test.** fetchBaseQuery turns a stub's throw into a `FETCH_ERROR`. With `methodOf` throwing on every call, 5 of the 32 tests that reach it stay green, so "silence really does mean agreement" was false. Fix: the pass bar is a grep for the logged line.
  - **MAJOR, §2: the log can be hidden.** In an AI-agent session, Vitest 4.1 with no `--reporter` uses its `agent` reporter (`silent: 'passed-only'`), which drops passing tests' console output. Fix: run the probe with `--reporter=default`.
  - **Probe result:** no disagreement, and none is possible in this suite. 52 calls: 50 `(Request)` with no `init`, 2 `(string, init)`, none with both a `Request` and an `init.method`. Result paragraph added to §2.
  - **MINOR, §3 step 2:** deleting only the definitions orphans the JSDoc on three `methodOf` copies (CaptionEditor, captionApi, useCaptionEditor). Fix: delete each definition with its JSDoc and trailing blank line.
  - **MINOR, §4 greps:** the ungrouped `function jsonResponse|urlOf|methodOf` matches every call site (225 lines). Fix: exact grouped commands, with the zsh quoting note.
  - **NIT, §2 step 2:** "convert only the 16 `methodOf` files to import it" was ambiguous; it now says to convert them completely (all helpers, SpeechEditDialog exception), which is what was validated.
  - **NIT, §3 step 5 / §4:** the optional test as listed is N = 7. It has no `urlOf` or non-default-status case, so only the `methodOf` and `bodyOf` mutations reach it.
  - **NIT, §4:** per-file counts come from one JSON-reporter run; baseline numbers and the measured mutation results added, and why files a mutation can't reach are still proven (tsc).
  - **NIT, Goal / §5:** exact copy count (92, 91 deleted). The same-body helpers under other names (13 `json`/`response`, 1 `jsonBodyOf`) are listed as out of scope.
  - Held up as written: the helper table, the 37-file list, the `methodOf` rule split, the `vi.mock`/`vi.hoisted` claim (7 calls, none references a helper), the SpeechEditDialog exception, the two `const urlOf` arrows, and the §1 module verbatim.
