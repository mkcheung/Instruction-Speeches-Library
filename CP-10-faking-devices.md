# CP-10 — Faking a microphone

> **Optional.** [Step 11](STEP-11-privacy-erasure.md) does not depend on this.

**Track:** Playwright · **Time:** ~3h · **After:** [Step 10](STEP-10-voice-annotation.md) · **Then:** [Step 11](STEP-11-privacy-erasure.md)

---

## 🎯 What you are learning here

1. How to test hardware **you do not have**.
2. How browser **permissions** work in automation, and why they're per-context.
3. The difference between **granting permission** and **providing a device** — two separate problems people conflate.
4. **What automation cannot cover**, and why writing that down is part of the job.

---

## Why this is a category of problem worth knowing

A CI runner has no microphone, no camera, no GPS, no notifications and no clipboard permissions. Yet real apps use all of those.

The general shape of the solution is the same every time, and it's two independent steps:

**1. Grant the permission** so the browser doesn't show a prompt. A prompt is fatal in automation — it's a native dialog, nothing clicks it, and the test hangs.

**2. Provide a fake device** so the API returns *something* instead of failing. Chromium can synthesize media streams — a generated tone for audio, a moving pattern for video.

**These are separate.** Granting permission without a fake device gets you a permission-granted `getUserMedia` that then fails because there's no hardware. That distinction is the thing worth taking away.

---

## Setup — in order

### 1. Launch with fake devices

`playwright.config.ts`:

```ts
projects: [
  {
    name: 'chromium-media',
    use: {
      ...devices['Desktop Chrome'],
      // Step 1: the permission — no prompt to hang on
      permissions: ['microphone'],
      launchOptions: {
        args: [
          // Step 2: the device — auto-accept, and synthesize a stream
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
        ],
      },
    },
  },
],
```

**Why both flags:** `--use-fake-ui-for-media-stream` auto-accepts the browser's own permission UI. `--use-fake-device-for-media-stream` makes `getUserMedia` return a synthetic stream. Either alone leaves you stuck.

### 2. Test recording

```ts
test('a coach can record a voice note', async ({ page }) => {
  await page.goto('/speeches/seeded/review');

  await page.getByTestId('player-pause').click();
  await page.getByTestId('record-start').click();

  await expect(page.getByTestId('record-status')).toHaveText('recording');

  // A real duration is legitimate here — you are recording actual audio,
  // so there is a genuine minimum. This is the rare acceptable wait.
  await page.waitForTimeout(2000);

  await page.getByTestId('record-stop').click();
  await expect(page.getByTestId('voice-note-waveform')).toBeVisible();
});
```

> **Note the exception.** [CP-07](CP-07-flakiness.md) says never wait on time. This is the case where the *thing itself* is a duration — you cannot record two seconds of audio in less than two seconds. **Waiting for a real-world duration is different from waiting for the app to catch up.** Comment it so nobody "fixes" it later.

### 3. Test the playback contract

This is the behaviour Step 10 actually promises:

```ts
test('a voice note pauses the video and resumes it', async ({ page }) => {
  await page.goto('/speeches/seeded/watch?review=1');   // seeded note at 150s

  await seekTo(page, 148);
  await page.getByTestId('player-play').click();

  await expect(page.getByTestId('voice-note-playing')).toBeVisible();
  await expect(page.getByTestId('player')).toHaveAttribute('data-paused', 'true');

  await expect(page.getByTestId('voice-note-playing')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('player')).toHaveAttribute('data-paused', 'false');
});
```

### 4. Test permission denied

Users say no. That path needs to explain itself rather than showing a dead button:

```ts
test('explains itself when the mic is refused', async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });   // grant nothing
  const page = await context.newPage();

  await page.goto('/speeches/seeded/review');
  await page.getByTestId('record-start').click();

  await expect(page.getByTestId('mic-denied-explainer')).toBeVisible();
});
```

### 5. Prove the Member gate

Step 10 requires **403 by direct API call**, not just an absent button:

```ts
const res = await memberPage.request.post('/api/annotations', {
  data: { review_id: 1, audio: '...' },
});
expect(res.status()).toBe(403);
```

**Why the API and not the UI:** an absent button proves the UI hides it. It does not prove the server refuses. Those are different claims, and only the second is a security property.

---

## The nuances

**Permissions are per-context, not global.** Setting them in the wrong place silently does nothing — no error, just a prompt that hangs the test.

**Fake-device support is Chromium-specific.** Firefox and WebKit have different or absent flags. **This test may reasonably be Chromium-only** — that's an acceptable, documented limit rather than a failure.

**The fake audio device produces a tone**, not speech. So you cannot meaningfully test Whisper transcription this way — assert that a transcript *job was queued*, not what it said.

**MediaRecorder output differs by browser** (§8.7): Firefox won't write MP4, Safari ≤18.3 won't write WebM. Step 10's construct-and-catch fallback should be tested with a **forced failure on the first preference**, so the fallback path is exercised rather than assumed.

---

## ⚠️ What automation cannot cover — and say so

Step 10's acceptance says **verified on iPhone Safari**. **A CI runner cannot do that.** WebKit on Linux is not Safari on iOS: different media stack, different autoplay rules, different permission UI.

> **Keep a short, explicit manual-test list**, and treat it as part of the deliverable rather than an admission of failure.
>
> For this product it's roughly: iOS Safari voice playback, iOS native fullscreen annotation fallback, and real screen-reader behaviour ([CP-15](CP-15-accessibility-gates.md)).
>
> **Knowing the boundary of your automation is a skill.** A suite that claims to cover things it doesn't is worse than one with a documented gap — the first gives false confidence, the second gives you a checklist.

---

## ⚠️ You will hit this

**The test hangs with no error.** A permission prompt appeared and nothing clicked it. Native dialogs are not in your DOM — check that `permissions` is set on the *context*, not somewhere else.

**Permission granted, but `getUserMedia` still fails.** You set the permission and forgot the fake device. **These are two separate problems** — that's the main thing this checkpoint is teaching.

**It works in Chromium and fails in Firefox/WebKit.** Expected. Fake-device flags are Chromium-specific. Scope this test to one project rather than fighting it.

**The transcript assertion fails.** The fake device emits a tone, not speech, so Whisper has nothing to transcribe. Assert that a transcription **job was queued**, not what it produced.

**Recording produces a zero-length file.** Usually stopping too fast — `MediaRecorder` needs a moment to flush. Wait for the `stop` event, not just the button click.

## Done when

- [ ] A voice-note recording test runs headless with no hardware
- [ ] The pause → play → resume contract is asserted
- [ ] Permission-denied is tested and shows an explanation
- [ ] **A Member gets 403 by direct API call**, not just a missing button
- [ ] Your manual-test list is written down somewhere real

Understanding:

- [ ] Why do you need *both* fake-device flags?
- [ ] Why are permissions per-context rather than global?
- [ ] Why is `waitForTimeout(2000)` acceptable here when CP-07 forbids it?
- [ ] Why test the Member gate through the API rather than the UI?

---

**Next:** [Step 11 — Privacy and erasure](STEP-11-privacy-erasure.md), then [CP-11](CP-11-isolation-and-parallelism.md).
