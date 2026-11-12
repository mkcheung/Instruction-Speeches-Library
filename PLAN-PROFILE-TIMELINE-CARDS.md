# Plan — profile timeline cards: honest copy, the right reviewer, compact rows, correct dates

Status: **implemented and verified, uncommitted — 2026-11-11.** Drafted by Claude against `development` at `4db1f29`. A–D are in the working tree exactly as written here; §11 records the checks.
- A read-only subagent mapped the current frontend first, and its load-bearing claims were re-checked by hand.
- A second, adversarial subagent then reviewed draft 1 against the code. It applied the plan to a scratch copy of `web/` outside the repository and ran CI's commands there.
- Each of its 12 findings was verified before being folded in (§10).

Frontend only: no API, migration or seeder changes.

## 1. What is wrong today (verified 2026-11-11)

Reproduced as `member@e2e.test` (Milo Member, `@e2e-member`, user 9004) on `https://app.speechcoach.test/u/e2e-coach/reviews-received`, the "Reviews they left you" tab of Cora Coach's profile (`coach@e2e.test`, `@e2e-coach`, user 9003).

| # | Symptom | Evidence |
| --- | --- | --- |
| 1 | The card says "🔒 Private · visible to you because you reviewed it", but the viewer did not review it | Review 3 has `reviewer_id` 9003 (Cora) and `speech_owner_id` 9004 (Milo). The sentence is hardcoded at [TimelineCard.tsx:61](web/src/components/profile/TimelineCard.tsx#L61). [ProfileTimelineFeed.tsx:77](web/src/components/profile/ProfileTimelineFeed.tsx#L77) knows `tab` and `firstName` but renders `<TimelineCard key={item.review_id} item={item} />` |
| 2 | "Your commentary" and "Watch with your commentary →" present Cora's 4 notes and essay as the viewer's own | Same component, [TimelineCard.tsx:73](web/src/components/profile/TimelineCard.tsx#L73) and [:84](web/src/components/profile/TimelineCard.tsx#L84) |
| 3 | The poster fills the screen | Speech 8's primary poster is 640×1138. [SpeechPoster.tsx:42-45](web/src/components/speech/SpeechPoster.tsx#L42-L45) sets an inline `aspect-ratio: 640 / 1138`, which beats the card's `aspect-video` class, so the image is ~1,030px tall in the 580px feed |
| 4 | The date is a day early: "October 18, 2026" for a speech delivered 2026-10-19 | [TimelineCard.tsx:7-10](web/src/components/profile/TimelineCard.tsx#L7-L10) does `new Date('2026-10-19')`, which is UTC midnight; any zone west of UTC displays the 18th. Reproduced in Node 22 under `America/Los_Angeles` |
| 5 | The link doesn't choose a reviewer | The card links to `/speeches/${speech.id}`. For the owner, [useCommentaryTrack.ts:80-88](web/src/hooks/useCommentaryTrack.ts#L80-L88) selects the most recently published review, whichever reviewer it belongs to, or none. In today's dev data, 4 of the 6 links land on Cora only because she is those speeches' only published reviewer. The other two (speeches 9402 and 9101) land on no selection at all |

"Test Unit" is not a bug: it is speech 8's stored title (description "Uncle and Niece Time"), and the card already renders `speech.title`.

## 2. Scope

| Item | Change |
| --- | --- |
| **A** | The "Reviews they left you" tab names the reviewer instead of saying "you". The "Reviews you left" tab keeps its copy |
| **B** | On the "Reviews they left you" tab, the link opens the named reviewer's commentary track |
| **C** | Both tabs render each review as a compact list row: a small thumbnail on the left, the text on the right. (The user chose this over a centered, height-capped poster.) |
| **D** | Date-only values display the calendar date they store, in every timezone |

**Not in scope:** renaming speech 8 or showing speech descriptions; any backend change; the items in §9.

## 3. How it works today (only the parts this plan touches)

- **Routes.** `/u/:username` renders [PublicProfile.tsx](web/src/routes/PublicProfile.tsx). Its `reviews-left` and `reviews-received` children are [ProfileReviewsLeft.tsx](web/src/routes/ProfileReviewsLeft.tsx) and [ProfileReviewsReceived.tsx](web/src/routes/ProfileReviewsReceived.tsx). Each derives `firstName = profile.display_name?.split(' ')[0] || profile.username` (line 9) and renders `<ProfileTimelineFeed key username tab firstName />`.
- **Feed.** [ProfileTimelineFeed.tsx](web/src/components/profile/ProfileTimelineFeed.tsx) pages through `GET /api/u/{username}/timeline?tab=` and renders one `TimelineCard` per item, passing only `item`. Its docstring (lines 13-17) says it "only owns the empty-state COPY".
- **Item shape** ([features/connection/types.ts:80-88](web/src/features/connection/types.ts#L80-L88)):
  - Fields: `review_id`, `status`, `last_transition_at`, `commentary {notes_count, has_essay}`, `speech {id, ulid, title, delivered_on, duration_seconds}`, `poster {url, width, height} | null`, `arc`.
  - There is no reviewer or owner identity: the tab says who is who.
  - `notes_count` is `published_annotations_count`, and `has_essay` is `essay_published_at !== null`.
- **What the received tab can list.**
  - `ReviewGrant::constrain` admits unrevoked `accepted`, `in_progress` and `published` reviews.
  - `status` becomes `published` only when notes are published (`ReviewService.php:600`).
  - Publishing an essay sets only `essay_published_at` (`EssayService.php:79`), so an `accepted` review can carry a published essay.
  - Dev data on Milo's received tab:

    | Review | Speech | Status | Notes | Essay |
    | --- | --- | --- | --- | --- |
    | 3 | 8 | published | 4 | ✓ |
    | 4 | 9 | published | 5 | |
    | 9611 | 9601 | published | 8 | |
    | 9411 | 9401 | published | 1 | |
    | 9413 | 9402 | accepted | 0 | |
    | 9201 | 9101 | accepted | 0 | ✓ (essay only) |
- **Poster.**
  - [SpeechPoster.tsx](web/src/components/speech/SpeechPoster.tsx) renders a `<picture>` with an inline `aspect-ratio` from the real dimensions, and an `<img class="h-full w-full object-cover">`.
  - With no poster it renders [NoPosterPlaceholder.tsx](web/src/components/speech/NoPosterPlaceholder.tsx): a colored 16:9 `div` (`aspect-video … text-3xl`) showing the title's initial. Every e2e speech takes this path.
  - The only other `SpeechPoster` caller is [MySpeeches.tsx:96](web/src/routes/MySpeeches.tsx#L96). It relies on real-ratio posters, and `SpeechPoster.test.tsx:62` and `MySpeeches.test.tsx:115` pin that.
- **Owner commentary selection.**
  - [SpeechWatch.tsx:438-439](web/src/routes/SpeechWatch.tsx#L438-L439) is the only caller of `useCommentaryTrack(speechId, videoEl, enabled, userId, notesVisible)`. The hook is enabled only for the owner, once the speech has a primary video.
  - It polls the review roster every 3s and keeps reviews that are unrevoked and access-granting.
  - An effect initializes the selection once per `${userId}:${speechId}`: the latest review with published notes (`first_published_at`), or none ([:80-88](web/src/hooks/useCommentaryTrack.ts#L80-L88)).
  - Chip clicks and the Essay picker go through `select`. A revoked selection falls back to none ([:90-97](web/src/hooks/useCommentaryTrack.ts#L90-L97)).
  - For non-owners the hook is disabled.
- **Query params.** `SpeechWatch` reads only `useParams`. No `?review=` exists anywhere in `web/src`, nothing calls `setSearchParams`, and notifications link to the bare `/speeches/{id}`.
- **Dates.** Only `TimelineCard` formats `delivered_on`. No shared date-only helper exists. [lib/time.ts](web/src/lib/time.ts) describes itself as the shared home for time formatting (it holds `formatTimestamp`).
- **Layout.** The desktop grid is `lg:grid-cols-[17rem_minmax(0,36.25rem)]`, so the feed is at most 580px. Below `lg` it is one column: 720px at 768, 343px at 375, 288px at 320. Below `sm` the card is `rounded-none border-y`.
- **Tests.**
  - No dedicated tests exist for `TimelineCard`, `ProfileTimelineFeed`, `ArcStrip` or the tab routes.
  - The only card test is [PublicProfile.test.tsx:357-415](web/src/routes/PublicProfile.test.tsx#L357-L415). It covers the left tab only, uses `delivered_on: '2026-03-12T00:00:00Z'` (not the wire format) and `duration_seconds: '494'`, and asserts:
    - the privacy line;
    - `12 notes · essay`;
    - exactly one `/watch with your commentary/i` link, with `href="/speeches/77"`.
  - No Playwright spec or visual baseline covers these tabs.

## 4. Decisions

### A1 — The card is told which side the viewer is on

`ProfileTimelineFeed` already has `tab` and `firstName`, and passes both to `TimelineCard`. The card needs no API change because the tab fully determines the relationship: on `received` the profile user is the reviewer and the viewer owns the speech.

| Element | "Reviews you left" (`left`) — unchanged | "Reviews they left you" (`received`) |
| --- | --- | --- |
| Privacy line | 🔒 Private · visible to you because you reviewed it | 🔒 Your private speech · shared with Cora |
| Commentary label | Your commentary | Cora's commentary |
| Commentary summary | `4 notes · essay` | `4 notes · essay`, or **Nothing published yet** when 0 notes and no essay |
| Link text | Watch with your commentary → | Watch with Cora's commentary →, or **Watch your speech →** when nothing is published |
| Link target | `/speeches/8` | `/speeches/8?review=3` (B1) |

- **"shared with Cora", not the "reviewed by Cora" first proposed to the user.**
  - The received tab lists `accepted` and `in_progress` reviews, where Cora hasn't reviewed anything yet. Review 9413 would have read "reviewed by Cora" above "Nothing published yet".
  - "Shared with" is true for every status the tab can contain. It answers the same question as the left tab's line: why is this visible here?
  - It doesn't claim Cora is the only one with access; other reviewers can have it.
- **The name** is the `firstName` the page already uses in "Your history with Cora", so a card can never disagree with its own page heading.
- **The possessive** is always `name + "'s"` (James → James's), with a straight apostrophe as elsewhere in the copy. It is built inline; no helper is needed for a template literal.
- **"Nothing published yet"** covers reviews with neither published notes nor a published essay (dev review 9413). Without it, the card would say "Watch with Cora's commentary →" over "0 notes" and open an empty track.
- **Essay-only reviews** (dev review 9201) keep the normal wording, "0 notes · essay" and "Watch with Cora's commentary →", because the essay is commentary. The watch page then shows its own "no commentary" notices on Notes while the essay sits on the Essay tab. That contradiction is the watch page's, it predates this plan, and it is listed in §9.
- **The left tab's copy is unchanged** as agreed, including its own inaccuracy for not-yet-published reviews (§9).

### B1 — The received tab's link names the review: `?review=<review_id>`

- New `web/src/lib/speechPath.ts`, modelled on [lib/profilePath.ts](web/src/lib/profilePath.ts):
  - `REVIEW_QUERY_PARAM = 'review'`
  - `speechPath(speechId, reviewId?)`, which returns `/speeches/8` or `/speeches/8?review=3`
  - `parseReviewQueryParam(value: string | null): number | null`, which accepts only `^\d+$` positive safe integers
- The card (writer) and `SpeechWatch` (reader) both import the constant, so the param name can't drift between them.
- The helpers must live in `lib/`. Exporting non-components from a `.tsx` component file fails `react-refresh/only-export-components`, which is an error in this repo.
- Only the received tab adds the param. On the left tab the viewer is a reviewer, for whom the hook is disabled, so the param would be inert. Leaving it off also keeps the existing `href="/speeches/77"` assertion valid.
- The param stays in the URL after use, like `?verified=1` today. It is a deep link, so a reload returns to the linked track. Stripping it would add the repo's first `setSearchParams` for no user-visible gain.

### B2 — An explicit `?review=` behaves like a chip click, not like the default

The default deliberately never selects a review without published notes (`SpeechWatch.test.tsx` "defaults … to the reviewer who published most recently", and "keeps an internal empty selection … when nobody has published"). A link the viewer clicked on Cora's card is an explicit choice:

| `?review=` value | Selection |
| --- | --- |
| A review in the hook's filtered roster (unrevoked, access-granting), published or not | That review |
| Missing, malformed, or not in that roster (another speech's review, revoked, declined) | Today's default: the latest review with published notes, else none |

When the requested review has no published notes, the owner sees the existing empty states, unchanged by this plan:
- **Notes tab:** "No commentary from this reviewer." ("No audio commentary from this reviewer." in voice mode), or "Commentary is off." when playback is Off ([CommentaryPlaybackControls.tsx:62-65](web/src/components/review/CommentaryPlaybackControls.tsx#L62-L65)).
- **Under the player** (only once the video source is ready):
  - "This reviewer has no published commentary yet."
  - or, when playback is Off, "Commentary is off. Open Notes to enable it."

  (See [OwnerVideoTools.tsx:39-41](web/src/components/review/OwnerVideoTools.tsx#L39-L41), driven by [SpeechWatch.tsx:448-450](web/src/routes/SpeechWatch.tsx#L448-L450).)

Falling back to the default rather than to "none" matches what a bare `/speeches/8` shows. A revoked review drops out of the timeline query, so its card and link go with it.

### B3 — Honor it inside the existing one-time initialization

`SpeechWatch` reads the param with `useSearchParams` and passes the parsed id to `useCommentaryTrack` as a new optional sixth argument, `requestedReviewId: number | null = null`. The hook does not read the URL itself, because `useCommentaryTrack.test.tsx` renders it with `renderHook` and no Router.

The only change inside the hook is the initialization effect:

```ts
const requested = requestedReviewId === null ? undefined : reviews?.find((review) => review.id === requestedReviewId)
// …existing `published` / `latest` lines unchanged…
select(requested?.id ?? latest?.id ?? NO_COMMENTARY)
```

`requestedReviewId` is added to that effect's dependency array.

Consequences, each confirmed by the adversarial review, by reading and by running the tests:
- The effect runs only until `choice.initialized` for the `${userId}:${speechId}` context. So the param is read once, after the roster arrives, and a late `userId` re-keys the context correctly.
- `select`'s early return cannot fire during initialization.
- Chip clicks, Essay-picker changes and 3s roster polls never snap the selection back.
- The revocation effect does not overwrite a valid requested choice.
- StrictMode's double-invoked effect calls `select` twice with the same value, and only re-arms the crossfade timer.
- The default reviewer's annotations are never fetched first. §6.6 asserts this.
- No new `setState` call in an effect is introduced. The existing `react-hooks/set-state-in-effect` disable comment on that `select` line stays where it is.
- A param changing while `SpeechWatch` stays mounted on the same speech is not re-read. No UI navigates between two `?review=` values of the same speech, and typing a URL reloads the page.

### C1 — A compact list row instead of a hero

```tsx
<article className="flex items-start gap-3 overflow-hidden rounded-none border-y border-border bg-card p-3 sm:gap-4 sm:rounded-lg sm:border sm:p-4">
  <SpeechPoster speech={posterSpeech} className="size-20 shrink-0 text-2xl sm:size-24" />
  <div className="flex min-w-0 flex-1 flex-col gap-1">
    <p className="text-[13px] text-muted-foreground">{privacyLine}</p>
    <h3 className="line-clamp-2 break-words text-[15px] font-semibold">{speech.title}</h3>
    {meta && <p className="text-[13px] text-muted-foreground">{meta}</p>}
    {item.arc && item.arc.length > 1 && <ArcStrip chain={item.arc} />}
    <p className="flex flex-wrap gap-x-1.5 text-sm">
      <span className="font-medium">{commentaryLabel}</span>
      <span aria-hidden="true" className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{summary}</span>
    </p>
    <Link to={href} className="mt-1 self-start text-sm font-medium text-primary hover:underline">{linkLabel}</Link>
  </div>
</article>
```

- **Square thumbnail, center-cropped.** It is 80px below `sm` and 96px from `sm` up.
  - Setting both width and height makes CSS ignore `SpeechPoster`'s inline `aspect-ratio`, and the existing `object-cover` crops. The reviewer confirmed this in Chromium, WebKit and Firefox. So `SpeechPoster`, MySpeeches and their tests stay untouched.
  - Square is the compromise between portrait and landscape. A square from a 640×1138 portrait keeps the middle 56% of its height, which includes the faces in speech 8's poster; a 16:9 crop would keep only 32%.
  - `text-2xl` shrinks the placeholder's initial: `cn`/twMerge drops its `text-3xl` and keeps `text-white`. Its `aspect-video` is ignored for the same both-dimensions reason.
- **The commentary box becomes one line.** A tinted box inside a text column costs ~24px per row. The summary keeps its own `<span>`, so `getByText('12 notes · essay')` still matches exactly.
- **An empty meta line is no longer rendered.** `speeches.duration_seconds` has no writer, and e2e speeches have no `delivered_on`, so today the card often shows an empty paragraph plus a gap.
- **The title clamps to two lines.** Screen readers still get the full text, and the watch page shows it in full. An unbreakable title clamps without overflowing (measured).
- **Still one link per card** (§6.7.4). The thumbnail stays decorative (`alt=""`) and is not a second link.
- **Size** (measured by the reviewer with Tailwind 4.3.3 and the app's font).

  | Width | Text column | "Test Unit" row | Privacy line |
  | --- | --- | --- | --- |
  | 580px | 434px | 156px tall (the portrait-poster card is ~1,250px today) | one line |
  | 320px viewport | — | 207px tall | two lines |

  No horizontal scroll at 1280, 768, 375 or 320. The 272px admin column (§9) also works.
- **Spec deviations,** recorded in the rewritten `TimelineCard` docstring:
  - `MODERNIZATION_PLAN.md` §6.7.4 (lines ~1059-1088) and `STEP-13-FROZEN-CONTRACT.md` (lines 155-157) call for a 16:9 hero, replaced here at the user's request. The current docstring's claim ("Reuses `SpeechPoster` unchanged for the 16:9 hero") was already false for real posters.
  - The specified privacy string (`MODERNIZATION_PLAN.md:1082`, `STEP-13-social-layer.md:32`) now applies to the left tab only.

### D1 — `formatCalendarDate` in `lib/time.ts`, parsed and formatted in UTC

```ts
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}/
const calendarDate = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** `delivered_on` is a calendar day, not an instant … */
export function formatCalendarDate(value: string | null): string | null {
  const day = value ? CALENDAR_DATE.exec(value)?.[0] : undefined
  if (!day) return null
  const date = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day) ? calendarDate.format(date) : null
}
```

- **Why UTC on both sides.** The leading `YYYY-MM-DD` is parsed as an explicit UTC instant and formatted in UTC, so the runtime zone never enters. Checked in Node 22 under Los Angeles and Tokyo for:
  - `2026-10-19`, the Postgres wire format;
  - `2026-10-19 00:00:00`, the shape SQLite may produce;
  - `2026-10-19T00:00:00Z`.

  All give October 19.
- **Why not the obvious fixes.**
  - Adding `timeZone: 'UTC'` to the old call fails because `new Date('2026-10-19 00:00:00')` (no `T`) parses as local time, which breaks east of UTC.
  - `Date.UTC(y, m, d)` (draft 1) maps years 0–99 to the 1900s and rolls invalid dates forward. The ISO parse gives "March 15, 44" for `0044-03-15` (a year Laravel's `date` rule accepts) and `null` for `2026-13-45`. The ISO parse alone is not enough for days 29–31: V8 rolls `2026-02-30` forward to March 2 (Firefox returns an Invalid Date), so the `toISOString()` round trip rejects any day the month doesn't have, in every engine (added in the 2026-11-11 code review).
- **Malformed input returns `null`** instead of throwing `RangeError: Invalid time value`, as `Intl.format(new Date('garbage'))` does today.
- **Name.** `formatCalendarDate` sits next to `formatTimestamp`. The name says what it accepts, not which field it was written for.

## 5. Implementation steps

Do them in this order. Each step leaves the suite green.

1. **D — `web/src/lib/time.ts`.** Add `formatCalendarDate` (D1). Create `web/src/lib/time.test.ts` (§6.1).
2. **B helper — `web/src/lib/speechPath.ts`** (B1). Create `web/src/lib/speechPath.test.ts` (§6.2).
3. **A + C + D wiring — `ProfileTimelineFeed.tsx` and `TimelineCard.tsx`.**
   - Feed:
     - render `<TimelineCard key={item.review_id} item={item} tab={tab} firstName={firstName} />`;
     - update its docstring, which no longer "only owns the empty-state COPY": it now also tells each card whose side the viewer is on.
   - Card props become `{ item, tab, firstName }: { item: ProfileTimelineItem; tab: ProfileTimelineTab; firstName: string }`.
   - Delete the local `formatDeliveredDate` and use `formatCalendarDate`. Keep `formatDuration` (unexported).
   - Derive `privacyLine`, `commentaryLabel`, `summary`, `linkLabel` and `href` from `tab`, `firstName` and `item.commentary` per A1. The href is `speechPath(speech.id, received ? item.review_id : undefined)`.
   - Replace the JSX with C1's row.
   - Rewrite the docstring: list row, tab-aware copy, one link, and the spec deviations in C1.
   - Update `PublicProfile.test.tsx` (§6.3).
4. **B consumer — `SpeechWatch.tsx` and `useCommentaryTrack.ts`.**
   - Import `useSearchParams` alongside `useParams` (line 4).
   - Add `const [searchParams] = useSearchParams()` and `const requestedReviewId = parseReviewQueryParam(searchParams.get(REVIEW_QUERY_PARAM))`, passed as the hook's sixth argument at line 438.
   - In the hook, add the parameter and B3's lookup.
   - Add the tests in §6.4–6.6.
5. **Verify** (§7). Don't commit unless asked. If asked, the natural split is D, then B (helper plus consumer), then A+C.

## 6. Tests

### 6.1 `web/src/lib/time.test.ts` (new)
- `'2026-10-19'`, `'2026-10-19 00:00:00'` and `'2026-10-19T00:00:00Z'` all give `'October 19, 2026'`.
- `'0044-03-15'` gives `'March 15, 44'`.
- `null`, `''`, `'not a date'`, `'2026-13-45'`, `'2026-02-30'`, `'2026-04-31'` and `'2026-02-29'` give `null`; `'2028-02-29'` gives `'February 29, 2028'`.
- **Regression under a negative-offset zone:**
  - `vi.stubEnv('TZ', 'America/Los_Angeles')` with `afterEach(() => vi.unstubAllEnvs())`, then expect `'October 19, 2026'`.
  - CI's vitest runs in UTC, where the old code also passes, so this case is the only guard.
  - The reviewer confirmed in vitest 4.1.10 (node and jsdom environments) that the stub takes effect, that the old expression reports "October 18" under it, and that `unstubAllEnvs` restores the zone.
  - **When implementing, repeat that red check once:** point the case at the old expression, see it fail, then restore.

### 6.2 `web/src/lib/speechPath.test.ts` (new)
- `speechPath(8)` gives `'/speeches/8'`; `speechPath(8, 3)` gives `'/speeches/8?review=3'`.
- `parseReviewQueryParam`: `'3'` gives `3`. Each of these gives `null`:
  - `null`, `''`, `'0'`, `'-1'`
  - `'abc'`, `'1.5'`, `'1e3'`, `' 3'`
  - `'9007199254740993'` (not a safe integer)

### 6.3 `web/src/routes/PublicProfile.test.tsx`
- **Existing left-tab card test (:357-415).**
  - Change the fixture's `delivered_on` to the wire format `'2026-03-12'`.
  - Assert the meta line `'March 12, 2026 · 8 min 14 sec'`. The fixture keeps `duration_seconds: '494'`, so a bare `'March 12, 2026'` would not match the element's text.
  - Keep every existing assertion, including `href="/speeches/77"` and the single-link count.
- **New: received tab, published.** Render `/u/jordan/reviews-received` with the same item and assert:
  - `🔒 Your private speech · shared with Jordan`
  - `Jordan's commentary` and `12 notes · essay`
  - exactly one link, named `/watch with jordan's commentary/i`, with `href="/speeches/77?review=501"`
  - no element with the text `/visible to you because you reviewed it/` or `Your commentary`
- **New: received tab, nothing published.** Use `status: 'accepted'` and `{ notes_count: 0, has_essay: false }`. Assert `Nothing published yet`, and a single `Watch your speech →` link that still carries `?review=501`.
- Factor the timeline item and fetch stub used by these three tests into a local builder in the test file, rather than copying the 60-line mock three times.

### 6.4 `web/src/hooks/useCommentaryTrack.test.tsx`
Add a mount variant that passes the sixth argument. Use a roster of an older published review and a newer published one (newer = today's default):
- Requesting the older review selects it.
- Requesting an `accepted` review with nothing published selects it (where the default is none).
- Requesting an id not in the roster selects the newer review (the default).
- Requesting a review with `revoked_at` set selects the newer review (the default).
- After a requested selection, `result.current.select(newerId)` followed by a rerender (same props, same roster) stays on the newer review, so a manual choice is never undone.

### 6.5 `web/src/routes/SpeechWatch.test.tsx`
- Give `renderWatch` an optional `route = '/speeches/17'` argument.
- Reusing the roster from the "defaults … most recently" test:
  - `/speeches/17?review=1` checks "Earlier Coach", not "Later Coach".
  - `/speeches/17?review=3` checks "Still Working Coach".
  - `/speeches/17?review=999` checks "Later Coach".
- Assert with `await waitFor(() => expect(chip).toBeChecked())`, as the existing test does. `stubWatchFetch` already answers `/annotations` for any rostered review id.

### 6.6 `web/src/routes/SpeechWatchOwnerTimeline.test.tsx`
- **`watch()`:** add an optional fourth argument to `watch(store, id, strict)`, `search = ''`, appended to `initialEntries`.
- **Stub override.** This file's `server()` answers `/annotations` only for `review(id).id` (501). Any other id is recorded in `unexpectedRequests`, which `afterEach` asserts is empty. So the test must answer both the roster and the requested review's annotations through `server`'s `override(request, url)` hook:
  ```ts
  const older = { ...review(17, 503), first_published_at: '2026-09-01T00:00:00Z', last_published_at: '2026-09-01T00:00:00Z' }
  const { requests } = server((_request, url) => {
    if (url.pathname === '/api/speeches/17/review-roster') return json({ reviews: [older, review(17)] })
    if (url.pathname === '/api/speeches/17/annotations' && url.searchParams.get('review_id') === '503')
      return json({ review_id: 503, reviewer: older.reviewer, annotations: notes(17) })
  })
  ```
- **The case:** render `watch(store, 17, true, '?review=503')` in **StrictMode**. Assert:
  - the older reviewer's chip ends up checked;
  - none of the `requests` was an `/annotations?review_id=501` fetch, so the default reviewer is never loaded first.
- The reviewer ran this case green with and without StrictMode, and with a pre-cached roster.

### 6.7 Unchanged on purpose
- `SpeechPoster.test.tsx`, `MySpeeches.test.tsx`, and every default-selection test (no param).
- Playwright `voice-annotations.spec.ts` Scenario G, which uses no param.
- No Playwright spec references the changed copy (`grep -rniE "watch with|reviewed it|reviews-received" web/tests`, no hits).

## 7. Verification

**From `web/`, CI's exact commands.** `tsc --noEmit` is a silent no-op here, and a type error also breaks the e2e image build.

```bash
npx tsc -b && npx eslint . && npx vitest run
```

On a scratch copy of `web/` with draft 1 applied, the reviewer got:
- `tsc -b`: 0 errors;
- `eslint .`: 0 errors (5 pre-existing warnings in untouched files);
- the full suite green, 139 files and 1,500 tests, once the two test fixes now in §6.3 and §6.6 were made.

**Manual check against the running dev stack.** `https://app.speechcoach.test` is served by the host Vite dev server: start `npm run dev` in `web/` if it 502s. No image rebuild is needed for frontend-only changes.

1. **Test Unit row.** As `member@e2e.test`, open `/u/e2e-coach/reviews-received` at desktop width. Expect six compact rows. The "Test Unit" row shows:
   - a square thumbnail
   - "🔒 Your private speech · shared with Cora"
   - "October 19, 2026"
   - "Cora's commentary · 4 notes · essay"
   - "Watch with Cora's commentary →", linking to `/speeches/8?review=3`, which opens with Cora's chip checked
2. **Review 9413 row (speech 9402).** It reads "Nothing published yet" and "Watch your speech →".
   - It opens `/speeches/9402?review=9413` with Cora's chip checked; without the param, nothing would be selected.
   - Notes says "No commentary from this reviewer.".
   - Under the player: "This reviewer has no published commentary yet." (or "Commentary is off. Open Notes to enable it." if playback is Off).
3. **Review 9201 row (speech 9101).** It reads "0 notes · essay" and "Watch with Cora's commentary →".
   - The roster shows two chips: Cora (9201) and Bram (9202), both accepted with published essays. 9203 is revoked, so it has no chip.
   - `/speeches/9101` selects nothing; the card's `/speeches/9101?review=9201` selects Cora. This is B's visible effect with today's data.
   - Expect the pre-existing contradiction (§9): Notes says "No commentary from this reviewer." while Cora's essay is on the Essay tab.
4. **Left tab.** As `coach@e2e.test`, open `/u/e2e-member/reviews-left`. The copy is unchanged, the rows are compact, and the links carry no `?review=`.
5. **Narrow widths.** Repeat step 1 at 768px and 375px:
   - no horizontal scroll;
   - 80px thumbnails below 640px;
   - titles clamp at two lines;
   - the privacy line wraps cleanly.

## 8. Risks and traps

- **Don't touch `SpeechPoster`'s inline `aspect-ratio`.** MySpeeches depends on it and two tests pin it. C works entirely through the className on the card.
- **D's only CI guard is the TZ-stubbed case** (§6.1). Keep the red check when implementing.
- **Strict fetch stubs.** `SpeechWatchOwnerTimeline.test.tsx` fails on any request it didn't expect, so any new `?review=` case there must stub the requested review's annotations (§6.6).
- **B silently does nothing for a speech without a primary video.** The owner tools, and so the hook, need one. Every timeline speech in dev data has one.
- **A login detour drops the query.** `returnPath.ts` keeps only the pathname, so after re-authenticating the page falls back to the default track. This is pre-existing (§9).
- **A stale cached roster.**
  - If an RTK-cached roster from a visit within the last 60s predates the requested review, initialization falls back to the default, and the next 3s poll does not re-initialize. It is recoverable with one chip click.
  - It could be closed by deferring initialization while a requested id is missing and the roster is refetching. Not worth the complexity now.

## 9. Out of scope (found while mapping or reviewing; none block A–D)

| Item | Where |
| --- | --- |
| The watch page tells the owner "No commentary from this reviewer." / "This reviewer has no published commentary yet." for a review whose essay is published (dev 9201, 9202). Wording such as "No published notes from this reviewer yet" would fix it; `OwnerVideoTools.test.tsx:135` pins the current copy | [OwnerVideoTools.tsx:39](web/src/components/review/OwnerVideoTools.tsx#L39), [CommentaryPlaybackControls.tsx:65](web/src/components/review/CommentaryPlaybackControls.tsx#L65) |
| The left tab's "visible to you because you reviewed it" is likewise premature for `accepted` reviews | [TimelineCard.tsx:61](web/src/components/profile/TimelineCard.tsx#L61) |
| The timeline lists soft-deleted speeches. `DB::table` bypasses `SoftDeletes`, there's no `speeches.deleted_at` predicate, and deletion deliberately leaves reviews unrevoked. Such a card would link to a 410; there are none in dev today | `ProfileTimelineController.php:56-74`, `SpeechDeletionService.php` |
| At ≥1024px an admin (for whom `ConnectionsRail` renders nothing) gets the feed in the 17rem column, because it is the grid's only child. The C row still works at 272px | [PublicProfile.tsx:124-126](web/src/routes/PublicProfile.tsx#L124-L126), [ConnectionsRail.tsx:14](web/src/components/profile/ConnectionsRail.tsx#L14) |
| The card name is `display_name`'s first word ("Dr." for "Dr. Cora Coach"). The watch page's chip uses first + last name, so the two can differ for custom display names. They agree for all e2e users | `ProfileReviews*.tsx:9`, `ReviewerIdentityFields.php:17-18` |
| Every card on a tab shares one link name. Each link could be described by its row's title via `aria-describedby`; this is pre-existing and not made worse by this plan | `TimelineCard.tsx` |
| ArcStrip prints the raw `2026-10-19` and labels the oldest version vN | [ArcStrip.tsx:37-44](web/src/components/profile/ArcStrip.tsx#L37-L44) |
| `speeches.duration_seconds` has no writer, so the duration segment never renders | `GenerateDataExport.php:36-40` |
| Review publish/revoke doesn't invalidate the `ProfileTimeline` cache | `web/src/features` tag config |
| The timeline returns only the 640px primary poster; a 96px thumbnail would be better served by the 320px variant | `ProfileTimelineController.php:58-63` |
| Three other inline `` `/speeches/${id}` `` links could use `speechPath` | `Dashboard.tsx:273`, `Search.tsx:87`, `MySpeeches.tsx:125` |
| Making the whole row clickable (a stretched link) | — |

## 10. Review log

**Validate → review → improve → validate.**
1. **Mapping.** A read-only subagent mapped the frontend. Its claims that shaped decisions were re-checked by hand:
   - no `?review=` or `setSearchParams` anywhere;
   - no `TimelineCard` tests;
   - the TZ isn't pinned;
   - the rail-null grid;
   - the hook test has no Router.
2. **Adversarial review.** A second subagent reviewed draft 1 against the code and a scratch copy of `web/`.
3. **Validation.** Each finding below was verified against the code or database before being applied.
4. **Final validation** is recorded at the end of this section.

| # | Severity | Finding | Verified by | Disposition |
| --- | --- | --- | --- | --- |
| F1 | blocker | §6.3 asserted `'March 12, 2026'`, but the fixture's `duration_seconds: '494'` makes the meta line "March 12, 2026 · 8 min 14 sec" | `PublicProfile.test.tsx:373`; reviewer's scratch run | §6.3 asserts the full line |
| F2 | blocker | `SpeechWatchOwnerTimeline.test.tsx`'s `server()` answers annotations only for review 501; any other requested id fails `afterEach` | `:287-289`, `:296-298`, `:473` | §6.6 stubs roster and annotations via `override` |
| F3 | major | "reviewed by Cora" is false for `accepted`/`in_progress` reviews, which the tab lists | DB (9413 accepted); `ReviewGrant`, `ReviewService.php:600` | Received privacy line is now "shared with Cora"; left-tab equivalent added to §9 |
| F4 | major | An essay can be published on an `accepted` review, so §3 misdescribed 9201. The watch page shows "no commentary" next to a published essay | `EssayService.php:79`; DB | §3 and §7 corrected; watch-page copy added to §9 |
| F5 | minor | B2 named only one of the three empty-state messages | `OwnerVideoTools.tsx:39-41`, `CommentaryPlaybackControls.tsx:62-65`, `SpeechWatch.tsx:448-450` | B2 and §7 list all three |
| F6 | minor | Dev-data errors: speeches 9402 and 9101 default to no selection, and 9203 is revoked, so 9101 shows two chips, not three | DB | §1 and §7 corrected |
| F7 | minor | The timeline lists soft-deleted speeches | No `deleted_at` predicate; deletion leaves reviews unrevoked by design | §9 |
| F8 | nit | `Date.UTC` maps years 0–99 to the 1900s and rolls invalid dates forward | Node 22 run | D1 parses `YYYY-MM-DDT00:00:00Z` with a NaN guard; §6.1 adds both cases |
| F9 | nit | The feed docstring would go stale; the deviation note omitted the copy change | `ProfileTimelineFeed.tsx:13-17` | §5 step 3 and C1 |
| F10 | nit | Identical link names across cards (pre-existing) | — | §9 |
| F11 | nit | Size estimates were off (434px column, 156px row) | Reviewer's measurements in 3 engines | C1 numbers replaced |
| F12 | optional | The stale-roster case could be closed | — | Kept as a documented risk in §8 |

**Final validation (2026-11-11, 17:40 PST), run by Claude directly.** The reviewer reached the account's usage limit just before this step, so I didn't resume it. All of this was run against the reviewer's scratch copy of `web/`, which sits outside the repository with its build and test caches redirected into the scratchpad:
- **The copy implements draft 2 exactly as written.** Checked by diff: D1's helper verbatim; B3's lookup and dependency; `SpeechWatch`'s param read; the feed and card per A1/C1; and every test in §6.1–6.6. The §6.5 and §6.4 cases are written as `it.each` tables.
- **`npx tsc -b`:** exit 0.
- **`npx eslint .`:** 0 errors. The 5 warnings are all in files this plan does not touch: `AuthShell.tsx`, `CoachApplicationForm.tsx`, `Home.tsx`, `SpeechCreate.tsx` and `tests/_axe-baseline-capture.spec.ts`.
- **`npx vitest run`:** 139 files and 1,498 tests passed. That includes every test §6 specifies.
- **D's red check, run under `TZ=UTC` as in CI:**
  - The old `new Date(value)` formatter passes without the stub, so CI's default zone alone would never catch a regression.
  - Under §6.1's `vi.stubEnv('TZ', 'America/Los_Angeles')` the old formatter fails (`Expected "October 19, 2026"`, `Received "October 18, 2026"`), while `formatCalendarDate` passes.
  - The scratch file was restored afterwards.
- **No leftovers from draft 1:** "reviewed by", `Date.UTC`, and the old dev-data claims now appear only in explanations and in this log.
- **Repository untouched:** `git status` shows only this file.

**Not validated here:** the manual browser checks in §7, which need the implemented change running on the dev stack (done in §11).

## 11. Implementation record (2026-11-11)

**Changed files.** Written by Claude, using the reviewer's scratch copy only as a reference. Its placeholder docstrings were not carried over, and neither was its deletion of existing test comments.
- **Source:** `lib/time.ts`, new `lib/speechPath.ts`, `TimelineCard.tsx`, `ProfileTimelineFeed.tsx`, `SpeechWatch.tsx`, `useCommentaryTrack.ts`.
- **Tests:** new `lib/time.test.ts` and `lib/speechPath.test.ts`; `PublicProfile.test.tsx`, `useCommentaryTrack.test.tsx`, `SpeechWatch.test.tsx` and `SpeechWatchOwnerTimeline.test.tsx`.
- **Not committed.**

**CI's commands in the real `web/`:**
- `npx tsc -b`: exit 0.
- `npx eslint .`: 0 errors. The same 5 warnings as before, all in untouched files.
- `npx vitest run`: 139 files and 1,507 tests passed.

**§7 manual check.** A headless Chromium drove `https://app.speechcoach.test` as `member@e2e.test` and `coach@e2e.test`.

| §7 step | Result |
| --- | --- |
| 1. Test Unit row | ✓ square 96px thumbnail, "🔒 Your private speech · shared with Cora", "October 19, 2026", "Cora's commentary · 4 notes · essay", one link `/speeches/8?review=3` → Cora's chip checked. Rows are 132–156px tall at 1280 |
| 2. 9413 row | ✓ "Nothing published yet · Watch your speech →" → `/speeches/9402?review=9413`. Cora's chip is checked; the default would be none. Shows "No commentary from this reviewer." and "This reviewer has no published commentary yet." |
| 3. 9201 row | ✓ "0 notes · essay" → `/speeches/9101?review=9201` checks Cora, not Bram. `/speeches/9101` checks neither. Same two notices (the essay-only contradiction in §9) |
| 4. Left tab as Cora | ✓ copy unchanged, compact rows, links `/speeches/{id}` with no `?review=` |
| 5. Widths | ✓ no horizontal overflow at 1280, 768 or 375. Thumbnails 80px at 375. Long titles clamp to two lines with an ellipsis |

- No page errors were logged.
- The first `/login` load in each fresh browser context stayed blank for 90s, and the retry worked. This is the known intermittent Vite dev-server stall; the login page is untouched by this change.
- **Cosmetic nit seen at 375px:** when the commentary line wraps, the "·" separator ends the first line ("Cora's commentary ·" over "4 notes · essay"). Left as is.
