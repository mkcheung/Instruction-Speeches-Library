# CP-08 — Testing a rich-text editor

> **Optional.** [Step 09](STEP-09-captions.md) does not depend on this.

**Track:** Playwright · **Time:** ~3h · **After:** [Step 08](STEP-08-essay.md) · **Then:** [Step 09](STEP-09-captions.md)

---

## 🎯 What you are learning here

1. Why `contenteditable` breaks the normal form helpers, and what to use instead.
2. **How to handle native browser dialogs** — they aren't in your DOM, and an unhandled one hangs the test.
3. Why you assert on **what the server received**, not on what the editor's DOM says.
4. How to test a **stored-XSS** defence properly — including the layer you can't reach through the UI.

---

## Why rich-text editors are hostile to automation

A normal `<input>` has a `value`. You set it, done.

A rich-text editor has **none of that**. It's a `contenteditable` div where the editor library — TipTap, Lexical — maintains its own document model in JavaScript and *renders* the DOM from it. The DOM is an output, not the source of truth.

Three consequences:

**1. `fill()` doesn't work.** It sets `value`, and there isn't one. It may appear to do nothing, or it may write into the DOM in a way the editor's model never sees — so it looks right and saves nothing.

**2. Text must be *typed*.** The editor listens to key events to update its model. `pressSequentially()` emits real key events; `fill()` doesn't.

**3. The DOM can lie.** What's rendered may not be what gets serialized on save. **So assert on the server**, not the markup.

---

## Setup — in order

### 1. Watch `fill()` fail

```ts
await page.getByTestId('essay-editor').fill('Hello');   // ✗ try it
```

**Do this deliberately.** Seeing it fail — silently, which is the annoying part — is worth thirty seconds.

### 2. Type properly

```ts
const editor = page.getByTestId('essay-editor');
await editor.click();                        // focus first — required
await editor.pressSequentially('Your opening was strong.');
```

For formatting, use real keyboard shortcuts, because that's what a user does:

```ts
await page.keyboard.press('Control+B');      // or Meta+B on macOS
await editor.pressSequentially('bold text');
```

### 3. Assert on the server, not the DOM

```ts
test('the essay saves what you typed', async ({ page }) => {
  await editor.click();
  await editor.pressSequentially('Your opening was strong.');

  await expect(page.getByTestId('essay-save-status')).toHaveText('saved');

  // Reload — this is the assertion that matters. It proves persistence,
  // not just that the editor is holding text in memory.
  await page.reload();
  await expect(page.getByTestId('essay-editor')).toContainText('Your opening was strong.');
});
```

### 4. The native dialog — the part that hangs

Step 08 warns on navigation with unsaved changes. That's `beforeunload`, a **native browser dialog**. It is not in your DOM, and **Playwright auto-dismisses dialogs by default** — so without a handler, your test silently proves nothing.

```ts
test('warns about unsaved changes', async ({ page }) => {
  await editor.click();
  await editor.pressSequentially('unsaved words');

  let dialogAppeared = false;
  page.on('dialog', async (dialog) => {
    dialogAppeared = true;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();     // stay on the page
  });

  await page.getByTestId('nav-dashboard').click();
  expect(dialogAppeared).toBe(true);
});
```

**Register the handler before triggering the dialog.** Afterwards is too late.

### 5. Test the XSS defence — at both layers

§6.6 sanitizes **on write and on read**, and the read-time pass exists so that a future bypass can be fixed without a data migration. **Testing only through the UI tests only the write layer.**

```ts
// Layer 1 — through the UI
await editor.click();
await editor.pressSequentially('<img src=x onerror="alert(1)">');
await page.reload();
await expect(page.locator('img[onerror]')).toHaveCount(0);

// Layer 2 — the one the UI can't reach.
// Write a hostile payload DIRECTLY to the column, then fetch it.
// This proves read-time sanitization independently. It's a backend test.
```

**Why layer 2 matters:** if you only test through the UI and someone later removes read-time sanitization, every test still passes — and the defence-in-depth §6.6 designed is silently gone.

---

## The nuances

**`pressSequentially` is slow by design** — one key event at a time. For a long essay, type a short sentence and use the API to seed longer content.

**Editor DOM structure is an implementation detail.** Don't assert on `<p>` versus `<div>`. Assert on **text content** and on **what the server stored**. Otherwise a TipTap→Lexical swap (a live risk under R15) breaks every test for no functional reason.

**Cross-platform modifier keys.** `Control+B` on Linux/Windows, `Meta+B` on macOS. Use `ControlOrMeta` if available in your version, or branch on `process.platform`.

**Autosave debounce interacts with typing.** `pressSequentially` may finish before the debounce fires. Wait for the status word — same lesson as [CP-07](CP-07-flakiness.md).

**Dialog types are distinct.** `alert`, `confirm`, `prompt`, `beforeunload`. Assert on the type, or you'll pass on the wrong dialog.

---

## ⚠️ You will hit this

**`fill()` silently does nothing.** Not an error — just no text. Now you know why.

**The test hangs on navigation.** Unhandled dialog. Register the handler first.

**Formatting assertions break on a library upgrade.** You asserted on markup. Assert on text and stored output.

**The XSS test passes trivially** because your payload was escaped as *text* by React before ever reaching the editor. Make sure you're testing the sanitizer, not React's default escaping — they're different defences.

---

## Done when

- [ ] The essay flow is covered: type, autosave, reload, content survives
- [ ] The **unsaved-changes dialog** is tested with a real handler
- [ ] The cross-reviewer isolation test passes ([CP-05](CP-05-two-users-one-test.md) technique)
- [ ] XSS is tested at **both** layers, including a payload written straight to the column

Understanding:

- [ ] Why doesn't `fill()` work on a rich-text editor?
- [ ] Why assert on the server rather than the editor's DOM?
- [ ] What happens to a test that triggers a native dialog with no handler?
- [ ] Why isn't a UI-only XSS test sufficient given §6.6's design?

---

**Next:** [Step 09 — Captions](STEP-09-captions.md), then [CP-09](CP-09-matrix-builds.md).
