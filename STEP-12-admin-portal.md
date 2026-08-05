# Step 12 — Admin portal and coach applications

**Duration:** 2.5–3 weeks · **Depends on:** [05](STEP-05-invitation-loop.md), [11](STEP-11-privacy-erasure.md) · **Unblocks:** [15](STEP-15-accessibility.md)
**Plan:** [§12 S12](MODERNIZATION_PLAN.md) · [§6.8 coach applications](MODERNIZATION_PLAN.md) · [§7.4 admin safeguards](MODERNIZATION_PLAN.md) · [§5.8 Filament](MODERNIZATION_PLAN.md)

## ✅ What you can do when this is finished

> Upload your certification PDFs, have an admin **open them safely** and approve you, get the badge, and **appear in the reviewer directory** — the whole loop, both ends.

### Demo script

1. As a Member, go to **Become a Coach**. Write a statement. Upload two certification PDFs.
2. Log in as an Admin. Open the Filament panel — behind a **separate route prefix**, with **2FA required**.
3. The application queue, oldest first. Open the application.
4. Click a PDF. ⚠️ **It opens on a different origin, as a download or in a sandboxed frame** — never inline on the panel's own origin, which holds your admin session.
5. Approve, with a reason.
6. The applicant gets an email. Their profile now shows a **Coach badge**.
7. Log in as a speaker. Open the reviewer directory from [step 05](STEP-05-invitation-loop.md) and **filter by credential.** The new Coach is there — closing a loop that `artisan user:grant-role` has been faking since step 05.
8. As the Admin, open any speech. **See every annotation grouped by reviewer** — the join the legacy schema's missing author column made unwritable.
9. Try to **add your own annotation as the Admin.** You cannot. Admins moderate; they do not participate.
10. Take down a speech. Suspend a user. **Their session dies within one request.**

## Backend

- `coach_applications` with the `open_slot` partial unique index and its state machine (`draft → submitted → under_review → approved | rejected`; `rejected → draft` legal, reusing the row).
- `application_documents` on **their own table** with `sha256`, magic-byte validation (`%PDF-`), size and page caps, randomized paths, and ClamAV.
- Filament 4 mounted behind the `admin` role on a **separate prefix with 2FA required**.
- ⚠️ `RoleAssignmentService` holding the last-admin named lock, wrapping assignment **and removal** — **never a direct `assignRole()` in a Filament action**, because §7.4 warns bulk actions bypass policies.
- Audited views of private data.
- The report queue (from [step 11](STEP-11-privacy-erasure.md)).
- Takedown and suspension.

## Frontend

**The applicant's side:** the application form, document upload, status, and the decision notification.

**The admin side is Filament:** user list **with a role filter** — the legacy app could not filter by role, so "show me all coaches" was impossible; all speeches; the **coaching-activity view**; the coach-application queue with the **sandboxed-origin PDF viewer**; the report queue; takedown; suspension.

## Deliberately stubbed

The connections admin view waits for [step 13](STEP-13-social-layer.md), because connections do not exist yet. **No force-directed graph, ever** — §6.7.5 answers all four questions an admin actually has with tables and aggregates.

## Containers introduced

`clamav`. **Teaches:** a container with a genuinely slow startup — and therefore the step where `healthcheck` + `depends_on: condition: service_healthy` stops being optional.

**Why here:** this is the **only** place the system accepts arbitrary binaries from unverified users and hands them to an administrator. The scanner arrives with the exposure that creates the need for it, which is also the only way to test it meaningfully.

## Acceptance

- [ ] A Member applies, an Admin approves, and the Member **appears in the reviewer directory built at step 05**
- [ ] ⚠️ An Admin reviews a certification PDF **without it ever being served from the panel's own origin**
- [ ] An Admin lists all coaches, opens any speech, sees every annotation grouped by reviewer, and can take down a speech
- [ ] ⚠️ **An Admin cannot accept an invitation, create an annotation, or write an essay — asserted by direct API call**, not just by an absent button
- [ ] Non-admins get **403 from every admin route**
- [ ] ⚠️ **The last admin cannot be deleted, demoted, suspended or erased — proven by a concurrency test** firing two deletes at the last two admins simultaneously
- [ ] **Demoting a coach leaves every review, annotation and essay they hold untouched** — demotion removes reach, not history

## Watch for

⚠️ **A PDF is a scripting environment, and the admin panel is the highest-privilege origin in the system.** Non-negotiables: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a sandboxed origin or CSP sandbox, magic-byte validation, randomized paths. **Never render one inline in Filament.**

**ClamAV is a good control against commodity malware and a weak one against a targeted attacker.** Adopt it; do not describe it as more than that.

**Retention:** certification documents are **third-party personal data**. The plan's default is purge 90 days after the decision, keeping only the decision record and hashes — recorded as [§20 Q18](MODERNIZATION_PLAN.md) for confirmation.

**On what verification proves:** nothing stops someone uploading another person's certificate. **Describe the badge accurately** — "an administrator has reviewed submitted credentials", not "verified coach". Overclaiming is a liability, not a feature.

> Revision 4 split this loop across two phases — the upload twenty weeks before the review. That is the horizontal pattern in miniature: **a form that writes to a table nobody reads.** Building both halves together is slightly *cheaper*, and it is the only version that ends in a user action.

---

## 🎓 Optional next: [CP-12](CP-12-required-checks.md)

| | |
|---|---|
| **Learn** | Required checks — CI that can actually block you |
| **Track** | CI |
| **Time** | ~2h |

**This is optional.** [Step 13](STEP-13-social-layer.md) does not depend on it — go straight on if you'd rather.

It's placed here because this step just produced the thing that checkpoint tests against, so the example is real code you wrote rather than a toy. See [LEARNING-TRACK.md](LEARNING-TRACK.md) for the full track.
