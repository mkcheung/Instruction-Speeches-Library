# Accessibility baseline — 2026-10-17

§7.7.4's prerequisite: a baseline captured against the code as it stood **before** any §7.7 fix landed, so the step's actual improvement is provable rather than asserted. Full raw results: `2026-10-17-baseline.json` (same directory).

## Tooling

- `@axe-core/playwright` 4.14.0 (`axe-core` 4.14.0), the exact package `CP-15-accessibility-gates.md:39` names.
- Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` — the checkpoint doc's own example set.
- Scoped, not disabled: `.video-js` excluded (confirmed third-party — Video.js's own control surface, touched in this codebase only via a CSS import and a className assignment in `VideoPlayer.tsx`), per CP-15 §4's "scope the scan rather than disabling the rule."

## Screens scanned

| Screen | URL | Logged in as | Variants |
|---|---|---|---|
| Annotation (authoring) | `/speeches/9601` | reviewer A (`coach@e2e.test`), an access-granting reviewer with 8 real seeded annotations | `collapsed` (page as loaded), `editor-open` (one annotation's inline editor open — CP-15's "scan more than once, this screen changes over time" nuance) |
| Playback | `/speeches/9601` | the speech's owner (`member@e2e.test`) | `default` |
| Profile/timeline | `/u/e2e-member` | reviewer A, viewing the member's public profile (real review history: 4 reviews, one published with 8 annotations, one with a published essay) | `default` |

## Results

| Screen/variant | Violations | Critical | Serious | Moderate | Minor |
|---|---|---|---|---|---|
| annotation/collapsed | 2 | 0 | 2 | 0 | 0 |
| annotation/editor-open | 2 | 0 | 2 | 0 | 0 |
| playback/default | 2 | 0 | 2 | 0 | 0 |
| profile-timeline/default | 0 | 0 | 0 | 0 | 0 |

**Zero critical violations anywhere. 2 distinct serious-impact rules, each recurring across the three authenticated screens** (the annotation and playback screens share the same global header/tab-strip chrome, which is where both live — not three independent bugs, two bugs that each show up wherever their shared component renders).

### 1. `color-contrast` (serious) — two separate real instances, same rule

- **Inactive tab labels**: foreground `#737373` on background `#f5f5f5` — measured ratio **4.34:1**, just under the required **4.5:1** for normal-weight text at ~14px. This is the muted/unselected state of the tab strip (`role="tab" aria-selected="false"`) shared by the "Speech tools"/"Your feedback" tab components on both the annotation and playback screens.
- **Destructive action buttons**: foreground `#e7000b` (red) on background `#fde6e7` (light red/pink) — measured ratio **4.0:1** against the same 4.5:1 requirement. Seen on the annotation row's "Delete annotation at…" button and an adjacent menu-trigger button with the same color pairing — the `destructive`-variant button styling.

Both are **near-misses** (4.34 and 4.0 against a 4.5 threshold), not gross failures — a small token/shade adjustment on either the muted-foreground color or the destructive-button background should close both.

### 2. `label-content-name-mismatch` (serious) — WCAG 2.5.3 Label in Name

The user-menu trigger button (`aria-haspopup="menu"`, `aria-label="Cora Coach"`) has visible text content that axe flagges as not included in its accessible name — i.e., what's visually printed on the button and what a screen reader/voice-control tool announces for it have diverged. This is the header's user-identity menu trigger, present on every authenticated page, which is why it shows up on both annotation and playback scans (it did not reproduce on the profile/timeline scan, likely because that screen's own header state differs — worth re-checking once this is fixed). Concretely a Dragon/voice-control user who reads "Cora Coach" on screen and says "click Cora Coach" may fail to activate it if the actual accessible name diverges from that visible string.

## What axe cannot see here (CP-15 §5's own point)

Not evaluated by this automated pass, and worth a deliberate human check before calling any of this "accessible," not just "violation-free":
- Whether the annotation list's reading order makes sense via screen reader, independent of its visual layout.
- Whether "Edit"/"Delete" button labels are distinguishable when a screen reader user has 8 of each on one screen (axe can't assess "useful," only "present").
- Whether focus lands somewhere sensible after opening/closing the inline annotation editor.
- The public profile page renders zero violations but **has no `<main>` landmark at all** — axe's ruleset didn't flag this (a `region`/landmark completeness check isn't in the WCAG-tagged rule set used here), but it's a real structural gap for screen-reader users who navigate by landmark, worth a human look even though the automated gate is silent on it.

## Fixture/seed commands (for reproducing this baseline from a clean DB)

```
docker compose exec -T app php artisan db:seed --class=Database\\Seeders\\E2ESeeder --force
docker compose exec -T app php artisan db:seed --class=Database\\Seeders\\E2ECaptionsSeeder --force
docker compose exec -T app php artisan db:seed --class=Database\\Seeders\\E2EVoiceAnnotationSeeder --force
```

## Capture script

`web/tests/_axe-baseline-capture.spec.ts` — capture-only, deliberately excluded from CI (not in `ci.yml`'s explicit spec list), not a permanent gate. Run with:

```
cd web && npx playwright test tests/_axe-baseline-capture.spec.ts --project=chromium --no-deps
```
