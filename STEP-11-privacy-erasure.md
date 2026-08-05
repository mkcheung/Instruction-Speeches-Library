# Step 11 — Privacy, erasure and moderation

**Duration:** 2 weeks · **Depends on:** [07](STEP-07-write-commentary.md), [08](STEP-08-essay.md) · **Unblocks:** [12](STEP-12-admin-portal.md), [14](STEP-14-deploy-hardening.md)
**Plan:** [§12 S11](MODERNIZATION_PLAN.md) · [§11 privacy](MODERNIZATION_PLAN.md) · [§14 audit](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> **Report a speech**, download an export of your own data as a file you can open, and **delete your account and watch everything go.**

This step is **half visible**. The report button, the export download and the deletion flow are real screens. The ordered deletion job has no UI by design — its artifact is a CLI command whose output *is* the specification.

### Demo script

1. Open someone's speech you have access to. Click **Report**. Choose a reason. Submit.
2. `php artisan reports:list` — it is there. (The admin queue arrives in [step 12](STEP-12-admin-portal.md).)
3. Go to your account settings. **Request an export.** A few seconds later, download it. **Open it.** It contains your speeches *and the commentary other people wrote about you*.
4. Run `php artisan privacy:erase --dry-run yourself`. **Read the output.** It prints the ordered plan with row and byte counts — and that printed order *is* §11.2, so reading it is reviewing it.
5. Now actually delete a test account. Every speech and asset is gone. The commentary that account *wrote* survives, attributed to **"Former reviewer"**.
6. `php artisan audit:tail` — the deletion is in the log.

## Backend

- The account-deletion job in **§11.2's defined order**: revoke sessions → delete media at storage → delete voice-note audio → delete speeches, assets, **transcripts**, reviews → null authorship → hard-delete profile and connections → anonymize the user row → write the audit entry.
- Data export **including the commentary written about you**.
- Retention lifecycle as a scheduled job.
- `reports` with the state a queue needs.
- `audit_log` writes at every §14 trigger point — ⚠️ **never inside a policy.** Policies are invoked speculatively (`Gate::allows()` in loops, `@can` in Filament column visibility), so the log would fill with reads that never happened.
- Terms and privacy notice.

## Frontend

- The report button on speeches and annotation sets.
- The export request flow and the download.
- The account-deletion flow **with its consequences stated plainly** — including that erasing a speaker destroys every reviewer's work on their speeches, which is correct and must be surfaced rather than discovered.
- A **"download my annotations" export for reviewers**, which is the mitigation §11.2 asks for.

## Deliberately stubbed

**The admin report queue does not exist** — reports land in a table and `php artisan reports:list` prints them until [step 12](STEP-12-admin-portal.md). Retention runs but nothing is old enough to be purged; a `--force-age` flag proves the query.

## Containers introduced

None.

## Acceptance

- [ ] Deleting an account removes every speech and asset, ⚠️ **nulls authorship while preserving commentary text**, and writes an audit entry
- [ ] ⚠️ **An automated test asserts no orphaned media remains** — **walk the storage prefixes**, not just the rows
- [ ] Two erased reviewers on one speech produce two **"Former reviewer"** tracks, disambiguated **positionally** — ⚠️ **without snapshotting the reviewer's name at publish time**, which would defeat the erasure it is meant to survive
- [ ] `php artisan privacy:erase --dry-run {user}` prints the ordered plan with row and byte counts, and **the printed order matches §11.2 exactly**
- [ ] A voice note's **audio is deleted and its transcript preserved** (§8.7)
- [ ] ⚠️ **A deleted speech takes its `speech_transcripts` row with it** (§6.12) — this is the one artifact that would leave *searchable text* behind if the cascade were ever wrong, so the orphan-walk must check it explicitly, not just the storage prefixes
- [ ] `profiles` and `connections` are **hard-deleted**, not nulled

## Watch for

⚠️ **§11.1's legal groundwork is not an engineering task and does not live in this step.** Start it at [step 01](STEP-01-identity.md); settle it before this one ships. It produces a document, not a screen, and **no engineering artifact stands in for it.**

R5 is the reason not to defer it: a data-residency or biometric finding arriving late invalidates work. Illinois BIPA and Texas CUBI cover **face and voice data** and carry private rights of action — and this product's core artifact is video of an identifiable person's face and voice.

---

## 🎓 Optional next: [CP-11](CP-11-isolation-and-parallelism.md)

| | |
|---|---|
| **Learn** | Test isolation and parallelism |
| **Track** | Playwright |
| **Time** | ~4h |

**This is optional.** [Step 12](STEP-12-admin-portal.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
