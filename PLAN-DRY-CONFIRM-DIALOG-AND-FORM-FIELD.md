# Plan: one `ConfirmDialog` shell and one `FormField`

**Status:** rev 2, 2026-11-18. **Validated on a scratch copy; not implemented.**
**Scope:** `web/src` only.
- Two new shared components: `components/ui/confirm-dialog.tsx` and `components/ui/form-field.tsx`.
- The 4 destructive dialogs and 8 form files that adopt them.
- One tightened assertion in `DeleteAccountDialog.test.tsx` (rev 2, §3 step 6).

No backend, no CSS and no other component changes. Every comment stays. One flagged markup change (D1); otherwise the rendered DOM and all behavior are identical.
**Baseline:** `development` at `4c37d96`. Line numbers below refer to it.

## Goal

| # | Duplication | One owner after |
|---|---|---|
| 1 | Four destructive dialogs (556 lines) hand-build the same alert-dialog shell: Root, optional destructive Trigger, Portal, Backdrop, Popup with a test id, Title, Description, a body, an optional "Type WORD to confirm" field, an error line, and the Cancel / destructive action row with its pending label | `ConfirmDialog` in `components/ui/confirm-dialog.tsx`. It is **presentational**: each dialog keeps its own state, matching rule, reset behavior, mutation and error text. |
| 2 | 20 plain label / input / error trios in 8 files: `<div className="flex flex-col gap-1.5"><Label htmlFor=…>…</Label>{control}<FieldMessage …/></div>` | `FormField` in `components/ui/form-field.tsx` |

## What the review established

**The four dialogs:**

| | `account/DeleteAccountDialog.tsx` (145) | `speech/SpeechDeleteDialog.tsx` (148) | `review/RevokeReviewDialog.tsx` (163) | `annotation/ClearAnnotationsDialog.tsx` (100) |
|---|---|---|---|---|
| `open` owned by | itself (`:51`) | **the parent** (props `open`, `onOpenChange`) | itself (`:54`) | itself (`:41`) |
| Trigger | destructive `sm` button "Delete my account" (`:89-91`) | **none** | destructive `sm`, label `triggerLabel` (`:93-95`) | destructive `sm`, **`disabled={disabled \|\| isClearing}`** (`:53-55`) |
| Confirm word | `DELETE`, always; match `typed.trim() === WORD` (**case-sensitive**, `:54`) | `REMOVE`, always; **case-sensitive** (`:64`) | `DELETE`, purge mode only; `typed.trim().toUpperCase() === WORD` (**case-insensitive**, `:80`) | `CLEAR`, published only; **case-insensitive** (`:43`) |
| Confirm input id | `delete-confirm-input` | `speech-delete-confirm-input` | `revoke-purge-confirm-input` | `clear-confirm-input` |
| Extra body | consequences `<ul>` (`:97-108`) | consequences `<ul>` (`:108-111`) | required "Reason" textarea (`:108-117`) | none |
| Error line | `<p role="alert" className="mt-2 text-xs text-destructive">` (`:122-126`) | the same (`:125-129`) | **`<p className="mt-3 text-sm text-destructive">`, no role** (`:139`) | **none** |
| Reset on close | in `onOpenChange` (`:81-87`) | an effect on `open` (`:66-80`) | in `onOpenChange` and on Cancel and success (`closeAndReset`, `:74-77`) | in `onOpenChange` (`:48-51`) |
| Cancel | `setOpen(false)` (`:129`) | `onOpenChange(false)` | `closeAndReset` | `setOpen(false)` (`:81`) |
| Action disabled | `!canConfirm \|\| isLoading` | `!canConfirm \|\| isLoading` | `!canConfirm \|\| isSubmitting` | `!canConfirm \|\| isClearing \|\| disabled` |
| Labels (pending / action) | "Deleting…" / "Delete my account" | "Removing…" / "Remove speech" | "Working…" / `triggerLabel` | "Clearing…" / "Clear all notes" |
| Popup test id | `delete-account-dialog` | `speech-delete-dialog` | `revoke-and-purge-dialog` / `revoke-dialog` | `clear-annotations-dialog` |

**What every dialog shares.** All four are ordered Title, Description, body, confirm field, error, buttons. The confirm-field markup is identical in all four apart from the id and word:

```tsx
<div className="mt-3 flex flex-col gap-1.5">
  <Label htmlFor={id}>Type <span className="font-mono font-semibold">{WORD}</span> to confirm</Label>
  <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
</div>
```

**The shell must not own the confirm state.**
- The matching rules really differ in case sensitivity.
- The reset semantics differ.
- `RevokeReviewDialog.tsx:63-73` documents a Base UI fact: setting the controlled `open` from outside, as a Cancel button does, never fires `onOpenChange`, so a reset placed only there is skipped on Cancel.

So `DeleteAccountDialog` (Cancel → `setOpen(false)`) and `ClearAnnotationsDialog` (Cancel → `setOpen(false)`; confirm → `onConfirm(); setOpen(false)`) keep a typed confirm word, and Delete's error, across Cancel. §3 step 4 confirmed this on the baseline. That is the latent bug Revoke fixed for itself. A shell that owned the state would change that behavior silently. This plan keeps every dialog's state and handlers exactly as they are.

**The field trios.** 20 sites, verified structurally: the wrapper, a `Label` with only `htmlFor`, exactly one `Input` or `Textarea`, a direct `FieldMessage`, then `</div>`. No `Label` carries any other prop.

| File | Sites (line of the `FieldMessage`) |
|---|---|
| `components/review/InviteReviewerPanel.tsx` | `:241` |
| `components/speech/SpeechEditDialog.tsx` | `:144`, `:155`, `:161`, `:173` |
| `routes/ForgotPassword.tsx` | `:63` |
| `routes/Login.tsx` | `:90` |
| `routes/Onboarding.tsx` | `:147`, `:152`, `:216`, `:222` |
| `routes/Register.tsx` | `:73`, `:85`, `:97` |
| `routes/ResetPassword.tsx` | `:71`, `:83`, `:95` |
| `routes/SpeechCreate.tsx` | `:102`, `:108`, `:144` |

**Five `FieldMessage` sites are not plain trios. Leave them unchanged:**
- `CoachApplicationForm.tsx:96`: the message shares a row with a character counter;
- `InlineField.tsx:112`: an inline editor;
- `InviteReviewerPanel.tsx:230`: the reviewer picker's error, a bare `FieldMessage` under the directory list;
- `Login.tsx:107`: the password row holds the "Forgot password?" link;
- `Onboarding.tsx:159`: username, which has markup after its message.

**Primitives.** `FieldMessage` (`components/ui/form-message.tsx:5`) renders `null`, or `<p role="alert" className="text-xs text-destructive">`. `Label`, `Input` and `Textarea` are the existing `components/ui` exports.

**Coverage.**
- Unit tests render three of the four dialogs: `DeleteAccountDialog.test.tsx` (5 cases); `SpeechDeleteDialog.test.tsx` (4) and `MySpeeches.test.tsx`; `RevokeReviewDialog.test.tsx` (5) and `ReviewerRoster.test.tsx`.
- **Nothing committed renders the real `ClearAnnotationsDialog`** (corrected in rev 2). `AnnotationComposerPanel.test.tsx:62` `vi.mock`s it with a stub button. No Playwright spec opens any of the four dialogs; the offline groups only check the "Delete my account" trigger's colour. For Clear, the §3 harness is the only check.
- No test asserts Revoke's error line, so D1 shows up only in the harness.
- Forms: `Login`, `Register`, `Onboarding`, `SpeechCreate`, `SpeechEditDialog` and `InviteReviewerPanel` have tests. **`ForgotPassword` and `ResetPassword` have none.** That is one reason §3 compares rendered DOM directly.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The one flagged change:** the shell renders the error as the existing `<p role="alert" className="mt-2 text-xs text-destructive">`. So `RevokeReviewDialog`'s error gains `role="alert"` and moves from `mt-3 text-sm` to `mt-2 text-xs`. | Three dialogs show the same kind of failure, and Revoke's isn't announced to screen readers. If you'd rather have zero visual change, drop D1's commit (commit B, §1): Revoke then keeps passing its own `<p>` through the shell's `errorNode` escape. |
| D2 | The shell is presentational. It receives `open`/`onOpenChange`, the typed value and its setter, `canConfirm`, `pending`, and the handlers from the caller. | It preserves each dialog's matching rule, reset semantics and error text, including the latent Cancel behavior, which is a separate fix (§4). |
| D3 | `FormField` takes the control as `children` and doesn't clone it. Each control keeps its own `id`, `aria-invalid` and `register(...)`. | No hidden prop injection, and identical DOM. The shared part is the wrapper, the label pairing and the error placement. |

## Ground rules

- **No behavior change apart from D1.** Same DOM and same props to every primitive:
  - inline handlers stay inline in the caller and pass through unchanged;
  - add no `memo`, `key` or new hooks.
- **Every comment stays,** next to the code it explains. The only allowed edit is a sentence the refactor makes false; §1 lists the one known case. Revoke's JSX comment (`:133-138`) moves with its error, onto the `error` prop. A `{/* */}` child can't sit between props, so it becomes a plain `/* */` attribute comment with the same text.
- **Shared components live in `components/ui/*.tsx`.** They export components only (react-refresh rule). `eslint.config.js` ignores `src/components/ui`, so review checks this, not lint.
- **Leave the five special field sites** and every other component unchanged.
- **Order: §1 (dialogs), then §2 (fields).** §1 is two commits so D1 can be dropped: commit A (the shell; Revoke on `errorNode`), then commit B (D1). The rev 2 test assertion is its own commit. §2 is one commit. Run CI's commands and the §3 checks after each.

## §1 `ConfirmDialog` (`web/src/components/ui/confirm-dialog.tsx`)

```tsx
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialogRoot, AlertDialogTrigger, AlertDialogPortal, AlertDialogBackdrop,
  AlertDialogPopup, AlertDialogTitle, AlertDialogDescription,
} from '@/components/ui/alert-dialog'

/** The destructive-confirmation shell. The caller owns all state: open, typed word, error and pending. */
export function ConfirmDialog({
  open, onOpenChange, trigger, testId, title, description, children,
  confirm, error, errorNode, canConfirm, pending, actionLabel, pendingLabel, onCancel, onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Renders a destructive `sm` trigger; omit when the parent opens the dialog. */
  trigger?: { label: ReactNode; disabled?: boolean }
  testId: string
  title: ReactNode
  description: ReactNode
  children?: ReactNode
  /** Renders the "Type WORD to confirm" field when set. */
  confirm?: { word: string; inputId: string; value: string; onChange: (value: string) => void }
  error?: string | null
  /** Replaces the standard error line (only if D1 is dropped). */
  errorNode?: ReactNode
  canConfirm: boolean
  pending: boolean
  actionLabel: ReactNode
  pendingLabel: ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <AlertDialogTrigger {...(trigger.disabled !== undefined ? { disabled: trigger.disabled } : {})}
          render={<Button type="button" variant="destructive" size="sm" />}>
          {trigger.label}
        </AlertDialogTrigger>
      )}
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup data-testid={testId}>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {children}
          {confirm && (
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor={confirm.inputId}>
                Type <span className="font-mono font-semibold">{confirm.word}</span> to confirm
              </Label>
              <Input id={confirm.inputId} value={confirm.value}
                onChange={(event) => confirm.onChange(event.target.value)} autoComplete="off" />
            </div>
          )}
          {errorNode ?? (error && (
            <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
          ))}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={!canConfirm || pending} onClick={onConfirm}>
              {pending ? pendingLabel : actionLabel}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  )
}
```

**Commit A is the shell above.** Revoke passes its own error line through `errorNode`, so the DOM is unchanged. **Commit B (D1)** switches Revoke to `error` and deletes `errorNode` from the shell (the destructured name, its type line and doc comment). The error line becomes `{error && (<p role="alert" className="mt-2 text-xs text-destructive">{error}</p>)}`. Without that deletion, the shell keeps an escape prop with no caller.

**Each dialog keeps its state, `canConfirm` rule and handlers verbatim.** Only its JSX return changes:

| Dialog | Props it passes |
|---|---|
| DeleteAccount | `open`, `onOpenChange={(next) => { setOpen(next); if (!next) { setTyped(''); setError(null) } }}` (verbatim), `trigger={{ label: 'Delete my account' }}`, `testId="delete-account-dialog"`, title/description verbatim, the `<ul>` as children, `confirm={{ word: CONFIRM_WORD, inputId: 'delete-confirm-input', value: typed, onChange: setTyped }}`, `error`, `canConfirm`, `pending={isLoading}`, `actionLabel="Delete my account"`, `pendingLabel="Deleting…"`, `onCancel={() => setOpen(false)}`, `onConfirm={() => void handleDelete()}` |
| SpeechDelete | `open`, `onOpenChange` (props), no `trigger`, `testId="speech-delete-dialog"`, `title={<>Remove "{speech.title}"?</>}` and the description as a string (rev 2: the row omitted both; `tsc` requires them), the `<ul>` as children, `confirm` with `speech-delete-confirm-input`, `error`, `canConfirm`, `pending={isLoading}`, "Remove speech" / "Removing…", `onCancel={() => onOpenChange(false)}`, `onConfirm={() => void handleDelete()}`. The reset effect stays. |
| RevokeReview | its `onOpenChange` verbatim, `trigger={{ label: triggerLabel }}`, the mode-dependent `testId`/title/description verbatim, the Reason field as children, `confirm={mode === 'purge' ? { word: CONFIRM_WORD, inputId: 'revoke-purge-confirm-input', value: typed, onChange: setTyped } : undefined}`, `errorNode={error && <p className="mt-3 text-sm text-destructive">{error}</p>}` in commit A and `error={error}` in commit B (D1), with the moved JSX comment above it, `canConfirm`, `pending={isSubmitting}`, `actionLabel={triggerLabel}`, `pendingLabel="Working…"`, `onCancel={closeAndReset}`, and `onConfirm` as its existing inline arrow verbatim |
| ClearAnnotations | its `onOpenChange` verbatim, `trigger={{ label: 'Clear all notes', disabled: disabled \|\| isClearing }}`, `testId="clear-annotations-dialog"`, title/description verbatim, `confirm={isPublished ? { word: CONFIRM_WORD, inputId: 'clear-confirm-input', value: typed, onChange: setTyped } : undefined}`, no error, `canConfirm={canConfirm && !disabled}`, `pending={isClearing}`, "Clear all notes" / "Clearing…", `onCancel={() => setOpen(false)}`, `onConfirm={() => { onConfirm(); setOpen(false) }}` |

**Equivalence notes:**
- **Clear's action disabled:** `!(canConfirm && !disabled) || isClearing` equals `!canConfirm || disabled || isClearing`. These are pure booleans.
- **The trigger's `disabled`** is passed only when the caller sets it, as today.
- **`confirm.onChange` and the setters:** `confirm.onChange: setTyped` receives the same `event.target.value` the inline handlers passed. The shell's `Input` still gets a fresh inline arrow each render, as before. Only `confirm.onChange` is now the stable setter. Nothing observable changes: the §3 props check records identical primitive props.
- **Imports:** remove the now-unused `Button`, `Input`, `Label` and alert-dialog imports from each dialog; `tsc -b` (`noUnusedLocals`) enforces this. `RevokeReviewDialog` keeps `Label` and `Textarea` for its Reason field.
- **One comment changes.** `DeleteAccountDialog.tsx:24-25` says it "copies `ClearAnnotationsDialog.tsx`'s typed-confirmation `AlertDialogRoot` shape verbatim". That is false afterwards, so reword it to "shares the typed-confirmation shape with `ClearAnnotationsDialog.tsx` through `ConfirmDialog`". The rest stays verbatim.

## §2 `FormField` (`web/src/components/ui/form-field.tsx`)

```tsx
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { FieldMessage } from '@/components/ui/form-message'

/** A labelled control with its field-level error underneath. The control keeps its own id and aria-invalid. */
export function FormField({ id, label, error, children }: { id: string; label: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldMessage message={error} />
    </div>
  )
}
```

**Each of the 20 sites:**

```tsx
<FormField id="email" label="Email" error={errors.email?.message}>
  <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
</FormField>
```

- The control element and every prop on it stay byte-identical.
- `label` is the existing label text. `error` is the existing `FieldMessage` expression.
- Remove `Label`/`FieldMessage` imports only where no other use remains. Login, Onboarding and InviteReviewerPanel keep both. SpeechCreate keeps `Label`: its `delivered_on` and earlier-attempt rows have no `FieldMessage`. ForgotPassword, Register, ResetPassword and SpeechEditDialog drop both. `FormBanner` stays in all eight.

## §3 Verification (in a scratch copy: before any edit, after §1 and after §2)

**CI and unit tests:**
1. Run CI's commands from `web/`: `npx tsc -b && npx eslint . && npx vitest run`.
   - In a scratch copy whose `node_modules` is a symlink, add `--configLoader runner` to vitest.
   - Record the baseline counts and per-test JSON. **Pass bar:** same counts and identical per-test outcomes.
   - **Result (rev 2):** at the baseline and after every commit: `tsc -b` clean; eslint 0 errors and the same 5 pre-existing warnings (SpeechCreate's moves from line 46 to 47 with the added import); vitest 146 files and 1612 tests, all passed, with per-test outcomes identical.

**DOM equivalence (scratch-only, never committed):** the main proof.

2. Write a temporary test file that renders each touched component in its key states and saves `document.body.innerHTML` per state (rev 2 saved the whole document's `outerHTML`). Run it on the baseline and after each step, then diff. **Pass bar:** identical DOM, except the D1 change to Revoke's error line, which must be the only difference.
   - **DeleteAccount:** closed (the trigger); open; a partial word; the full word; an error (mocked failure); pending.
   - **SpeechDelete:** open (controlled); the full word; an error.
   - **RevokeReview:** revoke and purge modes; a reason typed; an error.
   - **ClearAnnotations:** published and unpublished; disabled; clearing.
   - **The 8 form files:** initial render, a submit with empty fields, and a submit answered by a 422 whose `errors` names every field. An empty submit renders only 9 of the 20 trio messages; the 422 renders all 20. Add the three client-only states: Onboarding location over 80 characters, SpeechCreate with an earlier attempt picked, SpeechEdit with the title cleared. ForgotPassword and ResetPassword render through `renderWithProviders`, which already provides a memory router.
     - ResetPassword needs a `/reset-password/:token` route and `?email=`; without the token, submit stops at the missing-token banner.
     - SpeechEditDialog needs a changed field; an unchanged submit closes without a request.
     - InviteReviewerPanel needs a picked reviewer; submit is disabled until then.
   - **Also record** `document.activeElement`, each control's value, `disabled`, `aria-invalid` and `labels`, and each dialog's role and `aria-labelledby`/`aria-describedby` text. Rev 2 also covered the pending states and the Cancel, Escape and confirm reopen paths.
   - **Props check (rev 2):** a second copy of the file `vi.mock`s every primitive (`Button`, `Input`, `Label`, `Textarea`, `FieldMessage`, the seven alert-dialog parts) to record the props it receives, with children flattened the way React renders them. This catches dropped or renamed props and handler presence, which the DOM can't show.
   - **Result (rev 2):** 19 cases, 82 snapshots, identical across two baseline runs.
     - Commit A: 0 of 82 differ.
     - Commit B (D1): 2 differ (`revoke/error`, `purge/error`), only on the error `<p>`. It gains `role="alert"` and moves from `mt-3 text-sm` to `mt-2 text-xs`.
     - §2: the same 2 against the baseline, 0 against §1.
     - Focus is identical everywhere (on open, after Cancel, after an error), and so are accessible names, descriptions, labels and `aria-invalid`.
     - Props: 1173 distinct primitive prop records on each side; identical apart from the D1 `<p>` inside the popup's children. That includes the Trigger's `disabled` key (present for Clear only), its `render` element and every handler.

**Comments:**
3. Every comment in the 12 touched files appears verbatim afterwards, apart from the one sentence reworded in §1. List any other difference.
   - **Result (rev 2):** identical in all 12 files, and in the test file rev 2 touches, apart from the reworded DeleteAccount sentence. Comments were extracted with TypeScript's parser (JSX comments included) and whitespace-normalized. Revoke's moved comment keeps its text.

**Latent behavior (finding only; must stay unchanged):**
4. Characterize Cancel in DeleteAccount and ClearAnnotations: type the word, press Cancel, reopen. Record what the input shows before the refactor. It must show the same after.
   - **Result (rev 2), identical before and after:**
     - DeleteAccount: after Cancel and reopen the input still shows `DELETE`, and the destructive button is enabled at once. After a 500, Cancel and reopen still show the error and the word.
     - ClearAnnotations (published): `clear` survives Cancel, and also a confirmed clear, so the next clear needs no retyping.
     - Escape resets both: Base UI fires `onOpenChange(false)` for its own gestures, not for Cancel. SpeechDelete (its effect) and Revoke (`closeAndReset`) reset on Cancel.

**Offline browser run:**
5. Build `dist` with `npx vite build --configLoader runner`, then run:
   ```
   WORKSPACE_USE_BUILT_ASSETS=1 npx playwright test 'accessibility\.spec' 'app-shell\.spec' --project=chromium --no-deps --grep "isolated frontend|annotation notebook tools"
   ```
   This includes the guest-login form. Never run Playwright without `WORKSPACE_USE_BUILT_ASSETS=1` and `--no-deps`. **Pass bar:** identical per-test outcomes.
   - **Result (rev 2):** 78 passed at the baseline, after §1 and after §2, identical per test. None of the 78 opens one of the four confirm dialogs.

**Mutation checks** (apply one, confirm red, then revert):
6. Five mutations:
   - the shell ignores `canConfirm`;
   - the shell drops the confirm word from the label;
   - the shell drops `data-testid`;
   - `FormField` drops `<FieldMessage>`;
   - `FormField` drops `htmlFor`.

   Report any that stays green.
   - **Result (rev 2):**
     - M1 (ignores `canConfirm`): red, 7 vitest failures.
     - M2 (drops the confirm word): **green** in `tsc -b` and vitest, because every test finds the input with `getByLabelText(/Type/)`. Nothing else could catch it: eslint ignores `components/ui`, and no spec opens these dialogs.
     - M3 (drops `data-testid`): red, 15 failures.
     - M4 (drops `<FieldMessage>`): red, 6 failures.
     - M5 (drops `htmlFor`): red, 30 failures.
     - M1, M3, M4 and M5 also fail `tsc -b` (TS6133), because each leaves a destructured prop unused. That is incidental: a variant that kept the binding in use would rely on the tests alone.
   - **M2 fix (rev 2, its own commit):** in `DeleteAccountDialog.test.tsx:48`, `getByLabelText(/Type/)` becomes `getByLabelText('Type DELETE to confirm')`. It passes before and after the refactor and fails under M2. It pins the one shell line that now renders the word for all four dialogs.

**Not verified:**
- Other browsers and the real-stack Playwright specs (not run).
- A visual check of D1 in a browser, and its screen-reader announcement.
- Touch-device initial focus: Base UI focuses the popup itself there. The DOM order is unchanged, so it should match.
- After the merge, nothing committed pins Clear's wiring or D1's markup. The harness is scratch-only (§4).

## §4 Out of scope (found by the review)

- **The latent Cancel behavior** in `DeleteAccountDialog` and `ClearAnnotationsDialog`, confirmed by §3 step 4: a typed confirm word, and Delete's error, survive Cancel (and, for Clear, a confirmed clear). Worth prioritizing: on reopen, one click deletes the whole account without retyping. The fix is the one Revoke made for itself (`closeAndReset`). It changes behavior, so it belongs in its own change with its own test.
- **A committed test for the real `ClearAnnotationsDialog`** (none exists; see Coverage), and one that pins D1's error line. Until then, only the scratch harness checks them.
- **The five special `FieldMessage` sites,** and the `FormBanner` usages.
- **Other dialogs and other forms** not listed above.

## §5 Review log

- rev 1 (2026-11-18): drafted from a full read of the four dialogs at `4c37d96`, a structural classification of all 25 `FieldMessage` sites (20 plain, 5 special), the `ui` primitives, and a map of the tests covering each touched file.
- rev 2 (2026-11-18): applied as written to a scratch copy of `4c37d96` (§1 as commits A and B, then the test pin, then §2) and checked with CI's commands, the DOM and props harness, the comment extractor, the offline e2e and the five mutations. The table cells, line numbers, the 20 plain trios (each one `Input` or `Textarea` whose `id` matches its label) and the 5 special sites all held. No BLOCKER. Findings:
  - **MAJOR:** the coverage note was wrong for Clear. `AnnotationComposerPanel.test.tsx` mocks `ClearAnnotationsDialog`, and no committed test or spec renders it. Fixed in Coverage; follow-up in §4.
  - **MAJOR:** mutation M2 (shell drops the confirm word) stayed green in `tsc -b` and vitest, and nothing else covers it. Fixed with one tightened assertion: green at the baseline and after, red under M2 (§3 step 6, Scope).
  - **MINOR:** the §3 step 2 form states rendered only 9 of the 20 trio messages. Specified the 422-names-every-field state, three client-only states and the per-form preconditions.
  - **MINOR:** the D1 split was underspecified, and with D1 the shell kept `errorNode` with no caller. Specified commits A and B; B deletes `errorNode`.
  - **NIT:** the SpeechDelete row omitted `title`/`description`. Added, with the fragment form for the embedded title.
  - **NIT:** the import notes missed Revoke keeping `Label`/`Textarea` and SpeechCreate keeping `Label`. Added.
  - **NIT:** the moved Revoke comment has to change from `{/* */}` to `/* */` syntax. Stated.
  - **NIT:** the `onChange` equivalence note said the shell's handler is stable; only `confirm.onChange` is. Reworded.
  - **NIT:** eslint ignores `src/components/ui`, so the react-refresh rule isn't lint-enforced there. Stated.
  - **NIT:** the `InviteReviewerPanel.tsx:230` wording. Corrected.
  - Checked and left unchanged: `SpeechEditDialog.tsx:28-30` ("only `alert-dialog.tsx`") and `SpeechDeleteDialog.tsx:18` ("typed-confirmation `AlertDialogRoot`") stay true, since `confirm-dialog.tsx` builds on `alert-dialog.tsx`.
