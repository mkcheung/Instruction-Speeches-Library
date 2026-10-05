# PLAN — Fold "Invite a reviewer" into the Watch-screen Tab Strip

**Status:** ✅ **§4.1 implemented and verified** (see §10). §4.2 remains a proposal — and §10.2 corrects the premise it rested on.
**Date:** 2026-10-05
**Branch:** `development`
**Scope:** Frontend only. **No backend, schema, or API change is required** — every endpoint this needs already exists.

---

## 0. The ask

On the student's speech-viewing screen, the invite-a-reviewer UI should become
part of the `Notes | Essay | Transcript` tab strip rather than appearing above
it. If it moves onto the tabs, the separate button in the window can go.

**Answer: yes, and it is a small, low-risk change.** The invite UI is already an
inline panel rather than a modal, no test asserts on it, and the tab strip it
would join already renders in every state the invite button does. The design
questions worth deciding are *what the tab contains* (§4) and *what replaces
"Close"* (§5.3) — not whether the move works.

---

## 1. Verified current behaviour

Read from the working tree, not inferred.

### 1.1 It is not a dialog, despite the name

`web/src/components/review/InviteReviewerDialog.tsx:17-25` says so itself:

> built as an inline panel on the speech-watch page (toggled by an "Invite a
> reviewer" button) **rather than a modal dialog** — this codebase has no
> existing dialog wrapper component to match, and a panel needs none of that
> plumbing.

It renders a plain `<Card data-testid="invite-reviewer-panel">`. There is no
overlay, no focus trap, no backdrop.

### 1.2 Why it reads as appearing "atop" the tabs

It is rendered **between** the player card and the tab strip
(`web/src/routes/SpeechWatch.tsx:401-408`):

```tsx
{isOwner && inviteOpen && (
  <InviteReviewerDialog … />
)}

{/* STEP-08-FROZEN-CONTRACT.md's tab strip … */}
{isOwner && (
  <Tabs defaultValue="notes">
```

So opening it **inserts a tall card above the tabs and pushes the whole strip
down the page** — on a long reviewer directory, far enough that Notes/Essay/
Transcript can scroll out of view entirely. That displacement is the actual
complaint; nothing is overlaying anything.

### 1.3 The trigger

`SpeechWatch.tsx:291-295`, in the player card's `CardHeader`:

```tsx
{isOwner && !inviteOpen && (
  <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
    Invite a reviewer
  </Button>
)}
```

Backed by `const [inviteOpen, setInviteOpen] = useState(false)` (`:86`). Note
`!inviteOpen` — the button **hides itself** while the panel is open, which is
why the header appears to lose a control when the panel appears.

### 1.4 There are two tab strips, and only one is in scope

| Strip | Guard | `aria-label` | Tabs |
|---|---|---|---|
| Speaker/owner | `{isOwner && …}` (`:415`) | `"Reviewer feedback"` | Notes (TrackSelector) · Essay (read-only) · Transcript (CaptionEditor + settings) |
| Reviewer | `{!isOwner && myReview && asset?.status === 'ready' && initialUrl && …}` (`:473`) | `"Your feedback"` | Notes (composer) · Essay (editor) · Transcript (read-only) |

Inviting is owner-only, so **only the first strip changes.** The reviewer strip
is untouched.

### 1.5 ⚠️ The gating check that makes this safe

The invite button lives in the header, which always renders. If the tab strip
were gated on playback readiness, moving invite into it would make inviting
impossible while a video is still transcoding — a real regression.

**It is not gated.** The owner strip's only condition is `isOwner`
(`SpeechWatch.tsx:415`); grepping its whole block for `asset?.` / `initialUrl`
returns nothing. The reviewer strip *is* gated on `asset?.status === 'ready'`,
but that is the one not being changed. **Verified — the move preserves
reachability in every state.**

### 1.6 Nothing tests this

`grep` for `invite-reviewer-panel`, `"Invite a reviewer"`, `"Send invitation"`
and `InviteReviewerDialog` across `web/src/**` and `web/tests/**` returns only
the component's own file and unrelated doc-comment mentions
(`alert-dialog.tsx`, `avatar.tsx`, `ReviewerDirectory.tsx`). `SpeechWatch.test.tsx`
covers overlay positioning, the poster-frame picker and access states — never the
invite flow. **No assertion moves.** That is also a gap worth closing (§7).

---

## 2. Proposal

Add a fourth tab to the **owner** strip and delete the header trigger.

```
Before:  [ Notes | Essay | Transcript ]        + "Invite a reviewer" button in the header
                                                 → panel wedged above the strip

After:   [ Notes | Essay | Transcript | Reviewers ]
                                                 → panel renders inside its own tab panel
```

**Label: `Reviewers`**, not `Invite`. The tab is a place, not an action, which
matches its three siblings; and it leaves room for the roster in §4 without a
rename later.

**Position: last.** `Notes` stays the default (`defaultValue="notes"`) and the
reading-order of the existing three is unchanged, so nobody's muscle memory
breaks.

### 2.1 Changes

1. **Delete** the header button (`SpeechWatch.tsx:291-295`) and the `inviteOpen`
   state (`:86`), and the conditional render block (`:401-408`).
2. **Add** `<TabsTab value="reviewers">Reviewers</TabsTab>` and a matching
   `<TabsPanel value="reviewers">` holding the panel.
3. **Rename** `InviteReviewerDialog` → `InviteReviewerPanel` (file and symbol).
   The name is already wrong per §1.1 and becomes actively misleading once it is
   a tab panel. One import site.
4. **Relabel** the strip: `aria-label="Reviewer feedback"` no longer describes a
   strip containing reviewer *management*. Suggest `"Speech tools"`, or
   `"Feedback and reviewers"` if the feedback framing matters.

---

## 3. Why a tab is the right container here

- **It removes the displacement.** Tab panels occupy the same slot, so opening
  the invite UI can no longer push Notes/Essay/Transcript down the page.
- **It matches the page's existing idiom.** This screen already resolves
  "several related things, one at a time" with a tab strip; invite was the one
  exception, which is why it needed a bespoke open/close toggle.
- **It removes state.** `inviteOpen` duplicates what the tab strip already
  tracks. One fewer `useState` and no self-hiding button.
- **It is linkable later.** These are Base UI `Tabs` with string values; if a
  URL-synced tab is ever wanted (as `PublicProfile` did with real routes), a
  tab is already addressable in a way a transient panel never was.

**The honest trade-off:** invite drops from one click to two (open the tab,
then act), and it is no longer visible from the Notes tab. For an action taken
once or twice per speech — against reading commentary, which is continuous —
that is the right way round. If invite should stay one click, the alternative is
to keep a header button that *selects the tab* rather than toggling a panel;
that contradicts "we can remove it from the button in the window", so it is
noted, not recommended.

---

## 4. What the tab should contain

### 4.1 Minimum — relocate the form only

Move `InviteReviewerPanel` into the panel unchanged. Satisfies the brief
exactly. Smallest diff, nothing new to design.

One wrinkle: the panel is a `<Card>` with its own `CardHeader`/`CardTitle`
("Invite a reviewer"). Inside a tab panel that is a redundant second heading
under the tab label. **Recommend** dropping the card chrome in the tab context
(keep the `CardDescription` text as a lead-in), or passing a prop to suppress
the header.

### 4.2 Recommended — roster + form

A tab named `Reviewers` that shows only a form is a half-answer. The speaker
currently **cannot see who they have invited** anywhere on this screen.

Two facts make the roster nearly free:

- **`listSpeechReviews` is already fetched on this page.** `GET /api/speeches/{id}/reviews`
  via `useCommentaryTrack` (`hooks/useCommentaryTrack.ts:63`), owner-only. RTK
  Query dedupes, so reading it in the new tab costs **no extra request**.
- **`revoke` / `withdraw` / `abandon` mutations are built but unreachable.**
  `useRevokeReviewMutation`, `useWithdrawReviewMutation` and
  `useAbandonReviewMutation` are exported from `reviewApi.ts:138-140` and
  grep finds **zero call sites anywhere in the app** (verified exhaustively).
  The tab is their natural home.

Proposed panel content:

```
Reviewers
├── Invited          Milo Member   @e2e-member   [invited]    Revoke
├── In progress      Cora Coach    @e2e-coach    [in_progress] Revoke
├── Published        …                                        (link to track)
└── ──────────────────────────────────────────
    Invite a reviewer  ▸  (the existing form)
```

`ReviewStatus` is `'invited' | 'declined' | 'accepted' | 'in_progress' |
'published' | 'abandoned'` (`features/review/types.ts:10`), and `StatusBadge`
conventions already exist in `components/speech/StatusBadge.tsx`.

**Scope call:** §4.2 is a genuine feature addition beyond "fold the UI into the
tabs." Recommend shipping §4.1 first as the literal brief, then §4.2 as a
clearly-separate follow-up — not blending them into one commit.

### 4.3 ⚠️ Worth checking while in here

`useCommentaryTrack` maps **every** review from `listSpeechReviews` into the
track selector's options with no status filter
(`hooks/useCommentaryTrack.ts`, the `const options` block). If the backend does
not already restrict that list to published reviews, a merely *invited* reviewer
appears in the speaker's commentary dropdown with nothing behind it. **Unverified
— I did not read the controller.** Confirm against
`api/app/Http/Controllers/Api/ReviewController@index` before building the roster,
since both features read the same list.

---

## 5. Implementation detail

### 5.1 Target shape

```tsx
{isOwner && (
  <Tabs defaultValue="notes">
    <TabsList aria-label="Speech tools" className="flex-wrap">
      <TabsTab value="notes">Notes</TabsTab>
      <TabsTab value="essay">Essay</TabsTab>
      <TabsTab value="transcript">Transcript</TabsTab>
      <TabsTab value="reviewers">Reviewers</TabsTab>
    </TabsList>
    …
    <TabsPanel value="reviewers">
      <InviteReviewerPanel speechId={speechId} supersedesId={speech.supersedes?.id} />
    </TabsPanel>
  </Tabs>
)}
```

### 5.2 Responsive note

`TabsList` is `inline-flex w-fit items-center gap-1` (`components/ui/tabs.tsx:20`)
with **no wrapping**. Three short labels fit a 390px phone; a fourth may not.
Add `flex-wrap` to the `TabsList` (it accepts `className`), and check at 360px.
This is the one visual risk in the change.

### 5.3 `onClose` has no meaning in a tab

The panel takes `onClose` and `onInvited`, and its success state renders a
**"Close"** button (`InviteReviewerDialog.tsx:128-131`) — there is nothing to
close once it is a tab.

- Make `onClose` optional, and **render the Close button only when it is
  supplied**, so the component stays usable in both containers.
- On success, show the confirmation banner plus **"Invite someone else"**, which
  resets `success`/`selectedReviewer`/the form. Today `onInvited` closed the
  panel; in a tab it should simply return the form to a ready state.
- Drop `onInvited` from the call site, or repoint it at a roster refetch under
  §4.2.

### 5.4 Keep the form state alive across tab switches

Base UI unmounts inactive panels by default. A speaker who types a message,
flicks to Notes to check a timestamp, and returns would lose it. Set
`keepMounted` on the reviewers `TabsPanel` (or hoist the form state) so a
half-written invitation survives. **Verify the exact prop name against the
installed `@base-ui/react` version before relying on it.**

---

## 6. Files touched

| File | Change |
|---|---|
| `web/src/routes/SpeechWatch.tsx` | Remove button (`:291-295`), `inviteOpen` state (`:86`), conditional block (`:401-408`); add tab + panel; relabel strip |
| `web/src/components/review/InviteReviewerDialog.tsx` | Rename → `InviteReviewerPanel.tsx`; optional `onClose`; success-state rework; optional card-chrome suppression |
| `web/src/components/ui/tabs.tsx` | None — pass `flex-wrap` via `className` at the call site |

No route, API, type or schema change.

---

## 7. Tests

Currently **zero** coverage of the invite flow (§1.6). The move is a good moment
to add some, in `web/src/routes/SpeechWatch.test.tsx`:

1. **Owner sees a `Reviewers` tab; non-owner does not.** Guards the `isOwner`
   boundary that keeps invite owner-only.
2. **No "Invite a reviewer" button in the header.** Pins the removal.
3. **Selecting the tab reveals the reviewer search.** Replaces what the button
   used to prove.
4. **The tab is reachable while the video is still processing** (§1.5) — the
   one behaviour a careless implementation would regress.
5. *(with §4.2)* roster rows render per `ReviewStatus`, and revoke calls the
   mutation.

`SpeechWatch.test.tsx`'s existing fetch mocks are status-based and already stub
`/api/speeches/:id`; the reviewers tab adds `/api/speeches/:id/reviews`, which
must be stubbed or those mocks will throw.

E2E: `ci.yml` runs `speech-create`, `app-shell`, `essay-editor`, `captions` and
`voice-annotations` — none touch invite, so **no e2e change is required**.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Four tabs overflow a narrow phone | Medium | `flex-wrap` on `TabsList`; verify at 360px (§5.2) |
| Draft invitation lost on tab switch | Medium | `keepMounted`, prop name verified first (§5.4) |
| Invite unreachable while transcoding | **None** | Verified: owner strip is not gated on asset status (§1.5) |
| Tests break | **None** | Nothing asserts on this UI today (§1.6) |
| Invite becomes less discoverable | Low–Medium | Accepted trade-off (§3); `Reviewers` is a clearer label than a transient button |
| Stale roster after inviting | Low (§4.2 only) | `inviteReviewer` already invalidates the `Review` tag |

---

## 9. Open questions

1. **`Reviewers` or `Invite`?** Recommend `Reviewers` (§2) — a place, like its siblings.
2. **§4.1 or §4.2?** Recommend shipping §4.1 (literal brief) and treating the roster as a separate follow-up.
3. **Does the backend filter `listSpeechReviews` to published?** (§4.3) Needs one controller read; affects both the track selector and the roster.
4. **Keep a header shortcut that selects the tab?** The brief says remove the button; noted only for completeness.

---

## 10. Implementation record

§4.1 (the literal brief) is implemented. §4.2 (the roster) is **not** — and §10.2
below revises it, because the verification pass disproved one of its premises.

### 10.1 What shipped

| File | Change |
|---|---|
| `web/src/routes/SpeechWatch.tsx` | Removed the header button, the `inviteOpen` state, and the panel block that sat above the strip. Added `<TabsTab value="reviewers">Reviewers</TabsTab>` and a `<TabsPanel value="reviewers" keepMounted>`. Strip relabelled `"Reviewer feedback"` → `"Speech tools"`, `TabsList` given `flex-wrap max-w-full`. |
| `web/src/components/review/InviteReviewerPanel.tsx` | Renamed from `InviteReviewerDialog.tsx` via `git mv` (history preserved). `onClose` is now optional, and the Close **and Cancel** buttons render only when it is supplied. Success state gained **"Invite someone else"**, which resets the form via RHF `reset()`. New `hideHeading` prop drops the redundant card title under the tab label while keeping the descriptive sentence. |
| `alert-dialog.tsx`, `avatar.tsx`, `ReviewerDirectory.tsx` | Doc-comment references updated to the new name. |

Resolved open questions: **(1)** `Reviewers`, not `Invite`. **(2)** §4.1 only.
**(4)** No header shortcut — the button is gone, as asked.

### 10.2 ⚠️ Correction — §4.3 was wrong, and it weakens §4.2

§4.3 speculated that a merely-`invited` reviewer might appear in the speaker's
commentary dropdown with nothing behind it. **That bug is not real.**
`ReviewController@forSpeech` (`api/app/Http/Controllers/Api/ReviewController.php:194-209`)
filters:

```php
->whereIn('status', Review::ACCESS_GRANTING)   // ['accepted','in_progress','published']
->whereNull('revoked_at')
```

An `invited`, `declined`, `abandoned` or revoked review can never reach the
track selector. (An `accepted` reviewer who has published nothing *is*
selectable, but that is handled deliberately — `TrackSelector.tsx:166` renders
"… hasn't left commentary yet.")

**The consequence for §4.2 matters more than the correction.** §4.2 argued a
roster was "nearly free" because `listSpeechReviews` is already fetched on this
page. That is true but insufficient: **the endpoint deliberately excludes
`invited`**, which is exactly the status a speaker most needs to see. A roster
showing pending invitations therefore needs a backend change — a query
parameter, or a separate owner-scoped endpoint — not just a new component.
§4.2 should be re-scoped accordingly before anyone picks it up.

`useRevokeReviewMutation` / `useWithdrawReviewMutation` / `useAbandonReviewMutation`
remain exported with zero call sites, so that half of §4.2 still stands.

### 10.3 Verification

Facts confirmed against the installed library and the running app, not assumed:

- **`keepMounted` is real and necessary.** `@base-ui/react` 1.7.0 `TabsPanel.d.ts`
  declares `keepMounted?: boolean` with `@default false`, and `TabsPanel.js` does
  `shouldRender = keepMounted || mounted; if (!shouldRender) return null` — so an
  inactive panel is genuinely unmounted and a half-typed invitation would have
  been destroyed without it.
- **`flex-wrap` alone would not have worked.** The list is `inline-flex w-fit`
  (`components/ui/tabs.tsx:20`), i.e. sized to max-content, so it has no reason
  to wrap; `max-w-full` is what gives it one. At 390px all four tabs still fit on
  one row, so the cap is a guard rather than an active behaviour.

Live run against the dev stack, logged in as the speech owner:

```
URL: /speeches/17
tabs: Notes | Essay | Transcript | Reviewers
header invite button present? 0
search field visible after tab click? true
draft preserved across tab switch? "draft survives tab switch"
```

That last line is the `keepMounted` guarantee from §5.4, proven end-to-end:
text typed into the invitation message survived a switch to Notes and back.

Non-owner boundary, verified live as the reviewer on a speech they review:

```
URL: /speeches/9101
tablists: 1
  strip 0 -> Notes | Essay | Transcript
Reviewers tab anywhere? 0
invite search field anywhere? 0
```

**Tests:** 5 added to `web/src/routes/SpeechWatch.test.tsx` covering §7's items —
owner sees the tab; non-owner does not; the header button is gone; selecting the
tab reveals the search; and the tab stays reachable with
`primary_video.status: 'processing'`. The reveal test asserts
`not.toBeVisible()` *before* the click, because `keepMounted` puts the input in
the DOM from first render and `toBeInTheDocument()` would have passed without the
click doing anything.

Suite: **62 files, 344 tests passing** (was 339). `npx tsc -b` clean ·
`npx eslint .` 0 errors · screenshots checked at 1600px and 390px.

### 10.4 Risk table, re-rated after the fact

| Risk | Predicted | Actual |
|---|---|---|
| Four tabs overflow a narrow phone | Medium | **None** — all four fit at 390px; `max-w-full` guards regardless |
| Draft lost on tab switch | Medium | **Averted** — `keepMounted`, verified live |
| Invite unreachable while transcoding | None | **None** — owner strip is not gated on asset status |
| Tests break | None | **None** — nothing asserted on this UI |

### 10.5 Follow-ups surfaced, not actioned

- **`Speech.user_id` is optional** (`web/src/features/speech/types.ts`), with a
  stale comment deferring confirmation to "once the backend half of STEP-05
  lands." The entire owner-only surface — the tab strip, the caption editor, the
  poster picker and now inviting — gates on it. If the API ever stopped sending
  it, every speech would silently read as non-owned and the tab would vanish with
  no error. Worth making required.
- **Pre-existing mock bug in `describe('SpeechWatch access states')`.**
  `stubSpeechFetch` matches `url.includes('/api/speeches/')`, which also swallows
  `/api/speeches/:id/reviews`; the owner-render case therefore feeds
  `listSpeechReviews` a `{speech: …}` payload and `transformResponse` yields
  `undefined`. It does not throw today. The new block matches on pathname
  equality instead; the old block was left alone as out of scope.
- **`onInvited` was removed** from `InviteReviewerPanel` — it had no caller once
  the tab container began self-resetting. `onClose` was kept, per §5.3, as the
  optional-dismissal seam. Re-add `onInvited` if §4.2's roster needs a refetch
  hook.
