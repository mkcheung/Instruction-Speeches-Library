# DRY refactor plan: Friends and connections

Status: **assigned implementation completed and validated, 2026-10-25.** Drafted by Claude and independently revised against `development` at `7f3ce6e`. The original change range is `d8c578d..7f3ce6e`. After the plan-only review, the user authorized explorer-assigned workers, an integrated explorer review, repairs and platform validation. The initial explorer revalidated the plan and assigned the bounded work recorded in §10. The integrated explorer found no remaining blocking implementation error. Optional deferrals and validation limits are recorded below. No Git staging/commit, artifact removal, development-data reset or deferred lifecycle redesign is included.

## 1. Summary

Prioritize shared business rules and measurable query savings. Do not extract every repeated expression: helpers should make callers easier to understand and retain their distinct authorization, cache and wire contracts.

| Rule | Copies | Copy that drifted |
| --- | --- | --- |
| Username normalization | `Username::normalize` (PHP) and `normalizedUsername` (TS) | The TS copy doesn't transliterate `ø`, `ß`, `æ`, `đ` or Cyrillic → valid profile URLs render NotFound (F1) |
| Connection-pair invariant | `validatePair`, `relationship()`, `reciprocal()` SQL, and the reconciler's repair | Attribute repair carries blocker values into non-blocked states, producing pairs `validatePair` rejects (F2) |
| Administrative-role exclusion | `ConnectionEligibility`, `User::scopeNonAdministrative`, and `ReviewService::invite` | Share the administrative-role predicate only. Friends and reviewer eligibility are deliberately different; the proposed `erasure_started_at` gate is withdrawn (F3) |

Recommended order: fix F1/F2 and remove the read-path diagnostic query in F4, then consolidate backend rules and frontend cache/query helpers. Introduce the structural pair validator in the same work as F2 so every proposed repair is checked before persistence. Small presentation helpers remain optional when their added API would outweigh the duplication. Phase 0 intentionally changes behavior; later phases preserve behavior. F3 is a deferred privacy design issue, and F5 is separate repository hygiene.

### Corrections from the explorer review

| Priority | Draft mistake or omission | Correction |
| --- | --- | --- |
| High | F3 treated a voice-erasure stamp as full-account inactivity | Remove the blanket gate. It contradicts the approved Friends contract and an existing positive regression test. Track full-account erasure serialization separately. |
| High | F2 retained arbitrary lower-owner-wins block ownership | Never choose between conflicting non-null blockers. Leave ambiguous pairs unchanged and report them; preserve the standing block. |
| High | F2 checked only attribute-mismatched pairs | Validate missing-mirror, state-mismatch, attribute-mismatch and agreeing-but-invalid pairs before any repair; retain the lock/transaction guarantees. |
| Medium | B6 asserted a false equivalence between structural validity, visibility and sendability | Use a per-path expected-result matrix, including valid blocked/declined pairs and missing timestamps. |
| Medium | W1/W2/W7/W10 omitted distinct cache, reset and menu-composition behavior | Preserve invalidation subsets, viewer cache keys, explicit dismissal reset, DOM props/ref forwarding and Link/NavLink behavior. |
| Medium | Verification implied the existing PostgreSQL script and default Playwright config covered all new checks | Extend driver evidence for the new cases; use isolated browser setup and require non-skipped results. |
| Low | B4 promised byte-identical output despite differing path checks and key order | Preserve existing path semantics and assert decoded JSON contracts with a deterministic signer. |

## 2. Source-checked findings and dispositions

| # | Finding | Review severity | Verified against | Plan item |
| --- | --- | --- | --- | --- |
| 1 | The client copy of `Username::normalize` doesn't match `Str::ascii`: the API can resolve `/u/bjørn` to `bjorn`, while the SPA's redirect condition rejects it. Confirmed from source; no live HTTP reproduction in this review | normal | [PublicProfile.tsx:19](web/src/routes/PublicProfile.tsx#L19), [Username.php:26](api/app/Support/Username.php#L26) | F1 |
| 2 | Reconciler attribute repair copies a stale `blocked_by_id` onto both rows of a non-blocked pair, which leaves the pair permanently unusable (409) | nit | [ReconcileConnectionAsymmetryCommand.php:115-125](api/app/Console/Commands/ReconcileConnectionAsymmetryCommand.php#L115-L125) | F2, B6 |
| 3 | **Withdrawn proposed fix:** `erasure_started_at` also marks voice-only erasure; excluding it would permanently remove otherwise active Friends participants. A distinct full-account erasure race needs separate design | high regression risk in draft | [Friends contract:118](PLAN-FRIENDS-DISCOVERY-AND-REQUESTS.md#L118), [FriendDirectoryTest.php:50-57](api/tests/Feature/Connection/FriendDirectoryTest.php#L50-L57), [EraseSelfAccount.php:60-75](api/app/Jobs/EraseSelfAccount.php#L60-L75) | F3 deferred; B7 preserves eligibility |
| 4 | About 15 MB of local artifacts are tracked under `output/`; this is repository hygiene, not a runtime DRY defect | nit | `git ls-files output/` lists 10 files; `du -sk output` reports 14,792 KiB | F5, separate optional change |
| 5 | Cursor timestamp validation and encoding are copied instead of reusing `KeysetCursor` | nit | [FriendDirectoryService.php:265-274](api/app/Services/FriendDirectoryService.php#L265-L274), [ConnectionController.php:278](api/app/Http/Controllers/Api/ConnectionController.php#L278), [ProfileTimelineController.php:156](api/app/Http/Controllers/Api/ProfileTimelineController.php#L156) | B1 |
| 6 | Every Friends list request runs an extra EXISTS query only to log a warning, and the warning is never deduplicated | nit | [FriendDirectoryService.php:43-47](api/app/Services/FriendDirectoryService.php#L43-L47) | F4 |

## 3. Phase 0: fixes first (these change behavior, so write the tests first)

### F1. Canonical profile redirect without a client-side copy of the normalizer
- **Where:** [PublicProfile.tsx:19-21](web/src/routes/PublicProfile.tsx#L19-L21) and the redirect condition at [:61](web/src/routes/PublicProfile.tsx#L61).
- **Change:** The API echoes the exact decoded route argument it resolved, before normalization, as `requested_username` in the public-profile response. Pass request-specific metadata explicitly from `ProfileController::show`; never persist it on `User` or derive it from the canonical username. Update the response type/transform and affected fixtures together. Redirect only when the response is successful and settled, `profile.requested_username === username`, and `profile.username !== username`; delete `normalizedUsername`.
- Keep `currentData`, the fetching/error guards, strict canonical-profile equality, fresh-session and owner checks. The echo attributes the normalization result to this request; it is not an authorization signal. Do not accept an arbitrary settled mismatch, and do not expose private Friends content before the canonical route and identity checks pass. The existing mismatch regression must stay NotFound.
- **Tests:** add backend assertions for original decoded slug plus canonical username, and frontend cases for `/u/bjørn` → `/u/bjorn`, `/u/straße` → `/u/strasse`, case/whitespace and a supported non-Latin transliteration. Preserve child path, search, hash and replace-navigation behavior. Cover absent/wrong request attribution, fetch/error transitions and slug changes; unauthenticated public identity remains readable.

### F2. Reconciler repairs only valid, unambiguous pairs
- **Where:** [ReconcileConnectionAsymmetryCommand.php:115-125](api/app/Console/Commands/ReconcileConnectionAsymmetryCommand.php#L115-L125).
- **Change:** derive proposed attributes from the selected state. For non-blocked state, clear stale `blocked_by_id` on both sides, including when both currently contain the same stale value. For blocked state, propagate only a matching or single unambiguous participant blocker. If two non-null blockers disagree, report the pair and leave it unchanged: choosing the lower owner's row can transfer authority to unblock another person's block ([ConnectionService.php:140-146](api/app/Services/ConnectionService.php#L140-L146)). Never infer a blocker.
- Introduce the structural validator described in B6 alongside this fix. Validate an in-memory proposed pair before saving either row or creating a mirror. Cover **every branch**: missing mirror on either side, different states, different attributes, and agreeing attributes that still violate the invariant. Missing initiators for pending/accepted, invalid participant IDs and ambiguous initiator conflicts are report-only unless authoritative history establishes the value. Preserve nullable initiators for declined/blocked. Constraints already reject some corrupt shapes; test those with plain validator inputs rather than disabling constraints.
- Preserve the existing state-precedence policy for unambiguous state mismatches, including blocked winning, and normalize/validate the complete proposed result. Do not treat arbitrary ID order as evidence of user intent. Changing accepted-versus-declined precedence is a separate behavior decision (see §7). Count each unordered pair once; include unresolved/ambiguous counts in the run's aggregated structured warning log as well as command output, without names, notes or profile data. Do not invent historical timestamps.
- **Tests:** accepted/pending/declined pairs with one-sided **and matching** stale blockers clear them and remain service-usable; one missing unambiguous blocker can be copied where the schema permits that shape; conflicting blockers stay unchanged and neither user gains unblock authority. Cover state mismatches, both missing-mirror orientations, agreeing-invalid pairs, idempotent second run and rollback on failure. Existing reconciler tests create pending/accepted rows with null initiators; give intended repair-success fixtures explicit participant initiators locally, and keep separate report-only fixtures. Do not change the global factory to hide invalid data.
- **Concurrency/performance boundary:** keep repairs atomic. The current full-table `lockForUpdate()->get()` does not share the service's PostgreSQL advisory pair lock, has no explicit row order, and cannot lock absent rows. An advisory-lock retrofit must acquire locks **before** row locks and re-read the pair; adding it after the current sweep can deadlock. Track per-pair ordered transactions/bounded scanning and a reconciliation-versus-mutation PostgreSQL contention test with this work if the locking strategy changes. SQLite success does not establish PostgreSQL concurrency safety.

### F3. Withdrawn blanket erasure gate; separate privacy follow-up
- **Do not add** `whereNull('users.erasure_started_at')` to Friends eligibility. The approved contract explicitly forbids this ([PLAN-FRIENDS-DISCOVERY-AND-REQUESTS.md:118](PLAN-FRIENDS-DISCOVERY-AND-REQUESTS.md#L118)); `EraseSelfAccount` stamps the same field for voice-only erasure and never clears it. [FriendDirectoryTest.php:50-57](api/tests/Feature/Connection/FriendDirectoryTest.php#L50-L57) deliberately allows those accounts to discover, request and accept. Keep that regression unchanged.
- **Separate issue, deferred from the DRY refactor:** a full-account erasure can interleave with connection creation after the last eligibility read. A new, distinct full-account lifecycle marker and shared serialization with the erasure service need design and migrations before implementing a gate. A fresh `EXISTS` check inside a transaction does not itself lock either participant or close the race. Cover both actor/target and both interleavings with independent PostgreSQL workers, while preserving voice-only participation and cleanup actions. Do not claim this issue is fixed by B7.

### F4. Remove the EXISTS probe from the Friends read path
- **Where:** [FriendDirectoryService.php:43-47](api/app/Services/FriendDirectoryService.php#L43-L47).
- **Change:** delete the probe and its per-read `Log::warning`, and keep `whereNotNull('mine.'.$column)`. Move detection into `connections:reconcile-asymmetry`: count `accepted` rows with a null `connected_at` and `pending` rows with a null `requested_at`. Emit one aggregated `Log::warning` per affected run, optionally with console output. Console warnings alone are insufficient because [routes/console.php:48-52](api/routes/console.php#L48-L52) does not retain the scheduled command's output. Leave valid timestamps untouched and do not fabricate missing history.
- **Tests:** move the diagnostic assertion at [FriendDirectoryTest.php:179](api/tests/Feature/Connection/FriendDirectoryTest.php#L179) to the reconciler test; cover both timestamp columns and report row counts explicitly (two mirrored rows may represent one pair). Keep exclusion and cursor assertions in the read tests. Tighten the nonempty accepted-list query bound from five to four while retaining fixed counts at 1 and 20 results; discovery counts remain unchanged. Merely passing the old `<= 5` bound would not prove this optimization.

### F5. Optional separate repository hygiene
- `output/` has ten tracked files under `output/demo-profile-portraits/2026-10-23/`: `33-test2.png`, `9001-sadie.png`, `9002-adam.png`, `9003-cora.png`, `9004-milo.png`, `9005-bram.png`, `9006-cyrus.png`, `README.md`, `manifest.json`, `profile-avatar-backup.json`.
- If included in a later implementation request, re-enumerate the literal tracked paths and review whether any portraits/documentation are intended deliverables. Create a root `.gitignore` with `/output/` and untrack only the agreed exact files with `git rm --cached -- <literal paths>`. Local files must remain on disk. Do not run removal, staging or ignore changes during this plan review.
- Historical blobs remain. History rewriting/force-pushing is outside this refactor. This checkout also has ignore files under Docker certificate directories, so the original inventory claiming only four ignore locations was incomplete.

## 4. Phase 1: backend DRY (behavior unchanged)

### B1. One keyset cursor implementation (review #5)
- Make `KeysetCursor::validTimestamp` public. Delete `FriendDirectoryService::validTimestamp` ([:265-274](api/app/Services/FriendDirectoryService.php#L265-L274)) and call the shared one at [:147](api/app/Services/FriendDirectoryService.php#L147) and [:258](api/app/Services/FriendDirectoryService.php#L258).
- Delete the private `decodeCursor`/`encodeCursor` wrappers in [ConnectionController.php:273-281](api/app/Http/Controllers/Api/ConnectionController.php#L273-L281) and [ProfileTimelineController.php:151-159](api/app/Http/Controllers/Api/ProfileTimelineController.php#L151-L159). Their call sites then use `KeysetCursor::decode/encode` directly.
- Add `tests/Unit/KeysetCursorTest.php` (encode/decode round-trip, malformed input returns null) if no such test exists yet.

### B2. One keyset seek and one page slice
- The seek clause `(column < cursor_timestamp) OR (column = cursor_timestamp AND id_column < cursor_id)` is written 3 times: [ConnectionController.php:139-146](api/app/Http/Controllers/Api/ConnectionController.php#L139-L146), [ProfileTimelineController.php:82-89](api/app/Http/Controllers/Api/ProfileTimelineController.php#L82-L89) and [FriendDirectoryService.php:50-56](api/app/Services/FriendDirectoryService.php#L50-L56).
- The steps `limit + 1 → take → last → next cursor` are written 4 times: the two controllers plus `friends()` and `find()`.
- **Change, only if this simplifies the callers:** add a grouped descending timestamp/ID seek helper accepting both builders. The installed `Illuminate\Contracts\Database\Query\Builder` is an intentionally empty interface with a Query Builder mixin, and the Eloquent contract extends it; it accepts both at runtime. Nested callbacks must also accept the shared contract or both concrete builders: typing them only as Query Builder would fail when Eloquent supplies its own builder. Verify the chosen annotations under the installed Larastan rather than hiding errors with casts.
- A page helper must return **the trimmed rows on every page**, plus a clearly named nullable continuation row such as `lastForNext`. Null means no next cursor, not no results. Use generic collection/row PHPDoc to retain model vs `stdClass` typing. Preserve values/reindexing and the existing count-before-seek total.
- Keep cursor decoding/encoding at each caller, and keep hard-coded column names/aliases and order together: legacy `id`, Friends `connection_id` and discovery `person_id` are different. Discovery sorts ascending by person ID and must **not** call the descending timestamp helper. No user-controlled identifier may reach SQL through this helper. Test empty, partial, exactly-full, extra-row and tied-timestamp pages across Eloquent and Query Builder callers.

### B3. The two Friends FormRequests share their rules
- [ListFriendsRequest.php](api/app/Http/Requests/Connection/ListFriendsRequest.php) and [FindFriendsRequest.php](api/app/Http/Requests/Connection/FindFriendsRequest.php) are identical except for `view`: the same `search` rules, UTF-8 closure, `cursor` rule and `prepareForValidation()`.
- **Change:** `ListFriendsRequest extends FindFriendsRequest` and returns `parent::rules() + ['view' => ...]`, provided the base remains search/cursor-only and both preserve authorization and preparation. Keep incoming-view search restrictions in their current layer; inheritance must not silently expand accepted inputs. Use existing invalid UTF-8, nonscalar, oversized and unsupported-parameter feature coverage for both endpoints.

### B4. Friend resources and avatar URLs
- `FriendResource` and `FriendCandidateResource` build the same `person` block.
- The optional avatar presign is written 5 times in two styles: `ReviewerDirectoryResource:33`, `ConnectionResource:41` and `PublicProfileResource:53` use `$profile?->avatar_path ? … : null`, while the two Friend resources use `is_string && !== ''`.
- **Change:** consider `MediaUrlSigner::presignOptional(?string $path): ?string` for null/empty paths, keeping the existing disk, TTL, error propagation and one signing call per present avatar. The three truthiness-based callers currently also treat `'0'` as absent, while Friends signs it. Preserve that difference at those call sites, or classify a unified policy as a separately tested behavior change; do not claim an exact behavior-preserving substitution otherwise.
- If extracting the common person block, prefer a narrow helper usable by both resources rather than making the full Friend envelope depend on a candidate envelope. Keep discovery's `{id, name, avatar_url}` username-free and keep `username` only in Friend/legacy peer output. Never reuse reviewer role serialization or public-profile credential rules in this helper. Assert decoded JSON structure, types and nulls with a deterministic mocked signer; real signed URLs vary with time, and adding fields later also changes property order.
- Optional: `is_string($x) ? Carbon::parse($x)->toJSON() : null` appears 3 times (FriendResource ×2, `FriendDirectoryService:154`). Add a helper only if you're already editing those lines.

### B5. ConnectionService pair helpers
- `return $actor->id === $low->owner_id ? $low : $high;` appears 7 times ([lines 77, 95, 113, 127, 146, 157, 188](api/app/Services/ConnectionService.php#L77)), and `request()` repeats the same expression. Replace them with `sideOf(int $actorId, Connection $low, Connection $high)`.
- `foreach ([$low, $high] as $row) { …; $row->save(); }` appears 4 times ([lines 88, 121, 150, 181](api/app/Services/ConnectionService.php#L88)). Replace it with `writePair($low, $high, array $attributes)`. Keep one `save()` per model so timestamps and model events behave as they do now, and use `forceFill` so no change to `$fillable` is needed.
- Lower/higher id ordering is done 3 ways: `orderedIds(User, User)` at [:195](api/app/Services/ConnectionService.php#L195) and `min`/`max` at [:233](api/app/Services/ConnectionService.php#L233) and [:285](api/app/Services/ConnectionService.php#L285). Give it a single `orderedIds(int, int)`.
- Preserve the transaction, PostgreSQL advisory lock key, lower-ID-first row locking/writes, per-transition timestamp assignments and `request()`'s atomic SQL upsert. Keep ownership checks and eligibility checks at their current transition boundaries. `sideOf` only selects an already-authorized row; it cannot replace ownership validation. Do not place target eligibility into `writePair`/`lockPair`: decline/block must still sever a relationship to an inactive or newly administrative peer. Do not reset fields a transition currently leaves untouched.

### B6. Share structural validity; retain each path's projection rules
- The complete structural rule is: distinct participants; exactly reversed owner/peer IDs; matching known states; matching initiators that are participant IDs or null only for declined/blocked; matching blockers that are participant IDs for blocked and null otherwise. See [`validatePair`:251-267](api/app/Services/ConnectionService.php#L251-L267). Timestamps, eligibility, direction and sendability are additional path-specific rules.
- **Change:** introduce a small `ConnectionPair` validator alongside F2, with documented model/`stdClass` input shape and explicit missing-side handling. Preserve nullable IDs **before** integer conversion; do not turn null into zero or coerce malformed values into valid IDs. Use it in the service and proposed reconciler repairs, then in `relationship()` without removing that path's own blocked, eligibility, timestamp and direction rules. Keep exceptions/status handling with callers.
- `reciprocal()` stays in SQL for set-based pagination and mutual counts. Do not load the graph into PHP to reuse the validator. Sharing structural checks cannot determine who historically blocked whom; F2's ambiguous-blocker handling is a separate repair rule.
- Replace the draft's false all-path equivalence with a dataset that specifies **separate expected outcomes for each path**. Assume eligible, named non-self participants in this baseline table, and vary eligibility/direction separately:

| Pair shape | Structural validity | Relationship | Friends lists | Discovery with matching search | Reconciler |
| --- | --- | --- | --- | --- | --- |
| No rows | No complete pair | `none` | Absent | Included | No action |
| Valid accepted, usable connected time | Valid | `accepted`, own ID | Accepted | Excluded | Unchanged |
| Valid pending, usable request time | Valid | `pending`, direction and own ID | Incoming only for recipient | Excluded | Unchanged |
| Valid declined, including null initiator | Valid | `none`, no row ID | Absent | Included | Unchanged |
| Valid blocked, including null initiator | Valid | `unavailable`, no blocker identity | Absent | Excluded | Unchanged |
| Structurally valid accepted/pending with missing required time on viewer row | Valid | `unavailable` | Excluded for that view | Excluded | Report missing time; do not invent it |
| Missing mirror or corrupt pair | Invalid | `unavailable` | Absent | Excluded | Repair only if unambiguous and valid; otherwise report unchanged |

- Exercise both ID orientations, mismatched state/initiator/blocker, forbidden nulls, same stale non-blocked blockers, invalid participant IDs and model/query-row representations. Mutual-count expectations are separate: only valid accepted reciprocal edges through eligible third parties contribute, and the current mutual SQL has no timestamp requirement. Do not accidentally add one under a behavior-preserving refactor. Shapes blocked by database constraints belong in validator-unit tests, not fixtures that disable constraints. Run HTTP/service rejection cases as well as pure predicate cases.

### B7. Share administrative-role exclusion without merging participation rules
- Admin-tier exclusion is written 3 ways in this range: `User::scopeNonAdministrative` ([User.php:82](api/app/Models/User.php#L82), used by `ConnectionController::index` and `scopeReviewerCandidates`), a hand-written `whereNotExists` in [ConnectionEligibility.php:29-35](api/app/Support/ConnectionEligibility.php#L29-L35), and `hasAnyRole(Role::ADMIN_TIER)` in `ReviewService::invite`.
- **Change:** build `eligibleUserIds()` from `User::query()->nonAdministrative()…->toBase()` so the role subquery has a single definition. Preserve all current explicit active/identity predicates, `users.id` qualification, joins, morph/role semantics and the returned base Query Builder type. Do not add the withdrawn F3 predicate. Keep `nonAdministrative()` free of name, username and Friends-specific lifecycle requirements, as [User.php:76](api/app/Models/User.php#L76) says: the legacy list still serves unnamed accounts that aren't admins.
- Friends permits otherwise eligible roleless accounts; reviewer discovery requires member/coach; reviewer invitations have their own locked erasure gate and error status. Share the admin exclusion rule, not those complete policies. Do not replace fresh persisted-role SQL with a potentially cached loaded relationship, a frontend role check or a blanket Gate allowance.
- **Risk:** the SQL shape changes from the hand-written NOT EXISTS to Eloquent's `whereDoesntHave`. Check it against PostgreSQL with `scripts/verify-postgres-friends.php` as well as the SQLite suite.
- **RBAC regression matrix:** roleless/member/coach remain allowed when otherwise eligible; admin/super_admin and either mixed with member remain denied, including roles changed after the model was loaded. Preserve actor 403, target 404, self-request 422 precedence and owned-row 404. Keep cleanup against inactive/promoted peers. Retain `connection.block` authorization, its `$mustFallThrough` entry and [ConnectionBlockAbilityDenialTest.php](api/tests/Feature/Connection/ConnectionBlockAbilityDenialTest.php); a generic row selector/writer must never bypass them.
- Broader `isAdministrative()` changes across policies/providers/Filament are deferred. They have different caching and authorization contexts and are not necessary for this refactor.

## 5. Phase 2: frontend DRY (behavior unchanged)

### W1. connectionApi mutation boilerplate
- The 5 mutations repeat the same `transformResponse` ([connectionApi.ts:111, 117, 123, 129, 142](web/src/features/connection/connectionApi.ts#L111)) and the same 5-tag `invalidatesTags`. [profileApi.ts:36](web/src/features/profile/profileApi.ts#L36) keeps a 4-tag copy without `ProfileTimeline`.
- **Change:** one `unwrapConnection` function and typed constants for all registered tags, the five mutation invalidations and the four profile-change invalidations. Keep the current subsets; do not export one broad list and silently add `ProfileTimeline` invalidation to profile updates. A dependency-light tags module can avoid pulling API slice initialization into unrelated helpers. Validate literal tag typing with TypeScript.
- Adding timeline invalidation is a separate behavior/performance change that needs a concrete stale-cache regression first. Preserve successful-mutation-only cross-slice invalidation and explicit `connectionApi.util.invalidateTags` dispatch from `profileApi`; tags do not invalidate across separate API slices automatically. Do not alter session-generation resets or stale-response rejection.

### W2. Friends query arguments
- `getFriends` and `findFriends` trim `search` in both `query` and `serializeQueryArgs`. Extract only the normalization that is actually shared. Preserve `viewerId` in the serialized cache key even though it is deliberately omitted from the HTTP query, plus endpoint, view, cursor and current undefined/blank equivalence. Dropping viewer identity could merge private caches. Keep the cache-partition test in [connectionApi.test.ts:38-45](web/src/features/connection/connectionApi.test.ts#L38-L45); verify normalized wire arguments and cache identity separately.

### W3. One person type
- `ConnectionPeer` and `FriendPerson` in [types.ts](web/src/features/connection/types.ts) have the same four fields. Make one an alias of the other, and keep `FriendCandidate.person` as an `Omit<…, 'username'>`.

### W4. One profile URL builder
- `/u/...` paths are built by hand 13 times: ConnectionRequestsBell:58, ConnectionsRail:19 and :27, FriendPersonCard:46, ProfileConnectionAction:88, ProfileFriends:98, PublicProfile:66, :120, :123, :124 and :127, roles.ts:124, Dashboard.tsx:88. **Five of them skip `encodeURIComponent`**: PublicProfile:120, :124 and :127, roles.ts:124 and Dashboard:88.
- **Change:** add `profilePath(username, ...segments)` in `web/src/lib/profilePath.ts`, encoding the username exactly once. Restrict extra segments to internal route segments and do not treat search/hash as path segments. In PublicProfile:66 the existing path-prefix replacement stays and preserves the child route, search and hash; only the canonical prefix comes from this helper.
- `Username::pattern()` allows only `[a-z0-9_.-]`, which `encodeURIComponent` leaves unchanged, so hrefs for stored usernames should stay identical. Still check subpaths, empty/absent usernames and noncanonical redirect input; avoid double encoding.

### W5. One accept/decline/send action hook
- [FriendPersonCard.tsx:14-41](web/src/components/profile/FriendPersonCard.tsx#L14-L41) and `RequestRow` in [ConnectionRequestsBell.tsx:66-82](web/src/components/layout/ConnectionRequestsBell.tsx#L66-L82) both wire up the accept/decline mutations, a busy flag, the `connectionErrorMessage` error, the `Accepting…`/`Declining…` labels and the same success sentences: "You are now connected with X." and "Request from X declined."
- **Change, only if callers become simpler:** a per-instance action hook and/or shared outcome-message function in `features/connection`. Keep the bell's mounted guard, latest `onComplete` callback ref and `refreshing` lockout, plus the card's completed latch and `onUnavailable` on 403/404/409/422. Preserve crossed-request outcomes (`pending` versus `accepted`) and success announcements. Do not share busy/error state across cards, call completion twice or let a response from an obsolete viewer/session update the current screen.
- **Risk:** vitest and `friends.spec.ts` assert these strings, so keep them byte-identical.

### W6. Optional error/retry and loading presentation helpers
- The `<div role="alert"><p>{connectionErrorMessage(e)}</p><button>Retry …</button></div>` block appears 6 times: ConnectionRequestsBell:51, ConnectionsRail:22, ProfileConnectionAction:84 and :131, ProfileFriends:24 and :109. The `Loading…`/`Refreshing…` status appears 3 times: ConnectionRequestsBell:50, ConnectionsRail:21, ProfileFriends:108.
- **Change only if a small API suffices:** pass exact retry labels, loading/refresh text, classes and button presentation. The bell says "Loading requests…" / "Refreshing requests…"; other callers use different text. Keep plain button versus shared Button, size, variant, disabled state, alert/status semantics and dialog placement. ProfileConnectionAction's relationship retry and dialog retry have different sizes. If preserving those differences needs a large prop surface, leave the short markup inline. Existing accessible names and appearance are acceptance criteria.

### W7. Dismissals that last until the next fetch
- The `{ ids, snapshot }` state keyed to `query.fulfilledTimeStamp` is implemented twice: [ConnectionRequestsBell.tsx:29-36](web/src/components/layout/ConnectionRequestsBell.tsx#L29-L36) and [ProfileFriends.tsx:37, 81, 92](web/src/routes/ProfileFriends.tsx#L37). If extracted, return `{ dismiss, isDismissed, reset }` or support an explicit query identity that preserves every reset. ProfileFriends explicitly resets on applied search ([ProfileFriends.tsx:58-62](web/src/routes/ProfileFriends.tsx#L58-L62)); timestamp alone is insufficient across different cached queries. Keep per-instance state, generic ID typing, bell `connection_id` versus Friends `person.id`, and existing viewer/session-generation remounts. Cover a new search, cached-page return, refetch and account change.

### W8. Polling and focus refresh
- The bell's own `setInterval` ([:20-28](web/src/components/layout/ConnectionRequestsBell.tsx#L20-L28)) repeats the visibility check inside `useConnectionRefresh` ([connectionSession.ts:172](web/src/features/connection/connectionSession.ts#L172)). Add optional numeric `intervalMs`, used only by the bell with 60,000 ms. Keep per-caller listeners, latest callback via the existing effect-event mechanism, enabled/visible guards and timer/listener cleanup on disable or unmount. Depend on the numeric value, not a newly allocated options object. Preserve ProfileFriends' first-page-only passive refresh and existing session middleware; do not introduce global polling, global RTK listeners or cache-reset changes. Keep the bell's focus/visibility/poll/cleanup regression green.

### W9. Small helpers
- A `countLabel` helper for the three mutual-friend labels is optional; preserve exact singular/plural and zero text. It is not a prerequisite for fixing duplicated business rules.
- If extracting the `mounted` ref effect (ConnectionRequestsBell:71, ProfileFriends:41), set the ref true on every effect setup and false on cleanup, including React Strict Mode's setup/cleanup/setup sequence. Retain separate latest-callback refs and existing parent guards; a mounted ref alone does not protect against a changed session or stale callback.

### W10. Optional external-aware link rendering
- [AppSidebar.tsx:58-70](web/src/components/layout/AppSidebar.tsx#L58-L70) and [MobileNavigation.tsx:34-36](web/src/components/layout/MobileNavigation.tsx#L34-L36) each branch between `item.external ? <a rel="noreferrer"> : <NavLink>`. UserMenu removed that branch because account items are never external today.
- **Change only if the composition remains simple:** share the external-anchor decision and its `rel="noreferrer"` rule, without merging the menus or adding hypothetical external-account links. Preserve Sidebar active-class callbacks and `end`, mobile NavLink behavior, and UserMenu's ordinary Link behavior. A custom element passed through Base UI's `DropdownMenuItem render` must forward injected DOM props, event handlers and refs to the final anchor/router link. Prefer leaving the two branches in place if abstraction obscures that contract. Verify external href/rel, internal active state, keyboard activation, menu closing and focus restoration.

## 6. Phase 3: test helpers

### T1. Shared Friend factories for vitest
- 9 test files build `Friend`/`FriendsResponse` objects inline: PublicProfile.test has 10, ProfileConnectionAction.test has 9, and so on. Only [ConnectionRequestsBell.test.tsx:13](web/src/components/layout/ConnectionRequestsBell.test.tsx#L13) has a factory.
- **Change:** add `web/src/test/friendsFixtures.ts` with `makeFriend`, `makeCandidate`, `friendsResponse` and `relationship`. Migrate each test file as Phase 2 touches it, not as a separate sweep.

### T2. E2E XSRF header
- The cookie-to-header code exists 3 times: [voice-test-helpers.ts:183-185](web/tests/voice-test-helpers.ts#L183-L185), [essay-editor.spec.ts:220-222](web/tests/essay-editor.spec.ts#L220-L222) and [friends-fixtures.ts:84-89](web/tests/friends-fixtures.ts#L84-L89). A shared helper must take `apiUrl` and use `context.cookies(apiUrl)` so it cannot select another origin's XSRF cookie. Preserve decoding and the current explicit missing-cookie policy: voice/essay require one, Friends tolerates absence. Changing that policy or Friends' all-cookie lookup is a deliberate test-harness correction with focused verification. Keep `Origin`/`Accept` at callers because Friends uses distinct app/API origins, and retain all isolated-stack URL/database guards.

### T3. Friends fixture PHP
- The embedded PHP in [friends-fixtures.ts](web/tests/friends-fixtures.ts) creates users twice, once in the named-people loop and once in the pagination loop. Extract a `$make` closure inside the PHP string.
- Optional, outside this range: there are 4 e2e `login()` helpers (`loginFriend`, `_axe-baseline-capture:58`, `accessibility.spec:38`, `annotation-range/authoring:7`). They use different base URLs and account sources, so merge them only if the result stays simple.

## 7. Looks duplicated, but keep separate

- **The Friends cursor and `KeysetCursor` codecs:** the Friends cursor fails closed with a 422 and is bound to viewer, view and search. `KeysetCursor` silently restarts at page one. Share only timestamp validation between these codecs (B1); B2 may independently share query/page mechanics without merging formats or decode policies.
- **`reciprocal()` SQL and `ConnectionPair::isValid` PHP:** these are the same rule in different layers. Tie them together with the shared-dataset test (B6) rather than generating one from the other.
- **`ConnectionController::index` (legacy list) and `FriendDirectoryService::friends`:** the legacy list deliberately includes unnamed accounts that aren't admins. Merging the two would change who appears in it.
- **The `Connection` and `Friend` TS types:** they describe different wire envelopes. Only their person/peer sub-shape is shared (W3).
- **Laravel's `cursorPaginate()`:** it would change all three cursor formats and can't express the bound Friends cursor, so it isn't worth adopting here.
- **Friends and reviewer/account lifecycle eligibility:** roleless Friends participation, reviewer role requirements, voice-only erasure and full-account anonymization are distinct contracts. Share the narrow admin exclusion; defer F3's new full-account lifecycle/locking design.
- **Cleanup and creation authorization:** request/accept require an eligible target; decline/block cleanup intentionally does not. Preserve controller ownership checks, service actor checks and Gate restrictions independently of pair selection/writing helpers.
- **Reconciler precedence and structural validity:** existing accepted-over-declined precedence can restore a relationship when historical rows conflict. A structural validator cannot prove consent or chronology. Retain the documented legacy precedence only for unambiguous repairs in F2; defer any change to that policy for explicit behavior review. Conflicting block ownership is report-only regardless of structural validity.
- **Reconciler scaling/concurrency:** the existing full-table locking sweep is not proof of correct advisory-lock participation or bounded memory. Do not present helper extraction as a concurrency/performance fix. Any change to scan/locking strategy requires explicit ordered pair locks, fresh reads and PostgreSQL contention evidence; no generic lock helper should take a new advisory lock after holding row locks.

## 8. Verification and acceptance criteria

- **Backend (`api/`), during implementation:** `./vendor/bin/pint --test`, `php -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G`, then targeted Pest for the changed slice and a full Pest run at integration. Use explicit `DB_CONNECTION=sqlite DB_DATABASE=:memory: DB_URL=''` for local Pest so inherited shell configuration cannot redirect RefreshDatabase to real data. Raise memory for the full suite when needed (`php -d memory_limit=2G vendor/bin/pest`); do not label a memory crash as a code regression or assume another machine has the same limit. The existing CI uses unmodified Pest after preparing its environment.
- **PostgreSQL:** the existing root-level command `DB_CONNECTION=pgsql DB_DATABASE=friends_verify php scripts/verify-postgres-friends.php` requires a pre-migrated disposable database and actual isolated host/port/credentials. It inserts uniquely prefixed fixtures and retains them; it is not read-only. It currently checks Unicode/literal search, pagination, service contention and query plans, **not** the new reconciler/lifecycle matrix. Extend it or add a narrowly guarded driver test before claiming F2/B6 coverage. Verify B7's generated query on PostgreSQL, including mixed roles, morph matching, exclusions and query plans. Deferred F3 needs its own lifecycle and overlapping-worker scenarios; running the existing script does not validate it. Never use the development database or reset a shared stack.
- **Frontend (`web/`):** `npx tsc -b` (root `tsc --noEmit` is a no-op for this solution), `npx eslint .`, targeted Vitest, then `npx vitest run` at integration. Do not update snapshots or weaken guards to accommodate changed behavior. Include profile canonicalization, viewer-partitioned cache keys, session rollover, search/dismissal reset, mutation failures and timer cleanup.
- **Browser:** search `web/tests` for changed text/accessibility names before edits. `friends.spec.ts` skips the file without `FRIENDS_VERIFY_WRAPPER`; a skipped run is not success. Recreate the isolated Friends stack and explicit wrapper described in [the original implementation evidence](PLAN-FRIENDS-DISCOVERY-AND-REQUESTS.md#L269), using fresh uniquely named accounts. Use a dedicated temporary Playwright config with the Friends test and Chromium/WebKit projects, **without** the normal development warmup/auth dependencies. Record literal wrapper/config locations and the invocation before execution; require nonzero executed tests and report skips/flakiness. Rebuild whichever API image and frontend production bundle the chosen stack actually runs; do not refresh the user's development stack for a planning review.
- **Contracts/security:** preserve malformed-cursor 422 versus legacy restart behavior, own-row IDs, roleless participation, admin/mixed-role denial from fresh persisted roles, generic target errors, public coach-only credentials, username-free discovery, aggregate mutual counts and decline/block cleanup. No helper may introduce per-row queries, broaden payloads or weaken a denial. Required new regressions must fail against the old faulty behavior and pass with the fix.
- **Per-change gates:** keep commits focused and green using relevant checks; run complete backend/frontend suites and real driver/browser checks at integration. Presentation-only helpers need existing interaction coverage, not tests that only mirror a wrapper's implementation.

### Baseline evidence from this plan review (2026-10-25)

No implementation code was changed, and no PostgreSQL/browser verification stack was started or mutated. The source-checked findings above include gaps not covered by current tests; passing these baselines does not prove the proposed fixes.

| Check | Current result |
| --- | --- |
| Pest: `tests/Feature/Connection`, `tests/Feature/Privacy/AccountErasureServiceTest.php`, `tests/Feature/Review/ReviewerDirectoryAuthorizationTest.php`, explicit SQLite `:memory:` and PHP memory 2G | **110 passed, 788 assertions** |
| Vitest: connection feature, profile components, requests bell, ProfileFriends and PublicProfile tests | **112 passed across 9 files**; an existing React `act(...)` warning in the bell refresh test |
| TypeScript `npm run typecheck` (`tsc -b`) | Passed |
| ESLint `npm run lint` | Zero errors, five existing warnings outside the reviewed feature |
| Pint `--test` | Passed |
| PHPStan configured analysis | Normal invocation exited 1 without diagnostics locally; sequential `php -d display_errors=1 -d log_errors=0 -d memory_limit=1G vendor/bin/phpstan analyse --memory-limit=1G --debug --no-progress --error-format=table` **passed with zero errors**. Cause of the normal invocation's failure is unconfirmed; do not report it as a passing run. |
| PostgreSQL concurrency/EXPLAIN, browser suite, full Pest/Vitest suites | Not run during this planning review |

## 9. Execution checklist

Implementation checklist for the authorized work. Keep changes focused and validate affected behavior before proceeding; optional items need not become one broad abstraction sweep. No commits or staging are required by this request.

1. [x] F1: authoritative canonical redirect, API contract/types and regressions together
2. [x] F2 + B6 validator foundation: state-aware, unambiguous repairs across every branch; regressions first
3. [x] F4: aggregate operational timestamp diagnostic and remove read probe; assert reduced query bound
4. [x] B1: shared timestamp validation and cursor wrappers; optional B2 pagination abstraction deferred by explorer
5. [x] B3 + B4: shared request rules and narrow resource/signer helpers with preserved contracts
6. [x] B5: pair selection/writing helpers retaining authorization, locking and SQL upsert
7. [x] B6 consumers: relationship reuse and per-path SQL/PHP/reconciler outcome matrix
8. [x] B7: shared admin exclusion, fresh-role regressions and PostgreSQL query evidence
9. [x] W1–W3: tag subsets, transform/search helpers, preserved viewer cache keys and person type
10. [x] W4: encoded profile paths and redirect suffix preservation
11. [x] W7/W8: complete dismissal reset and opt-in polling lifecycle; T1 alongside touched tests; optional W5 action hook deferred
12. [x] W9 mounted-ref helper; explorer deferred optional W6/count-label W9/W10 abstractions
13. [x] T2–T3: origin-scoped XSRF helper and local fixture PHP reuse, preserving isolated-stack guards
14. [x] Integration: complete suites, extended disposable PostgreSQL checks and non-skipped isolated browser workflows
15. [ ] F5: optional separate artifact disposition/ignore change, deliberately excluded from this implementation

**Deferred:** F3 full-account lifecycle/race remediation, any reconciler scan/lock redesign not included with F2, accepted-versus-declined precedence changes, broader administrative-policy cleanup and history rewriting. These require their own concrete design and validation; this plan does not describe them as fixed by DRY extraction.

## 10. Authorized implementation and validation — 2026-10-25

The initial explorer rechecked the source and divided work into exclusive file ownership:

| Segment | Assigned work | Integration boundary |
| --- | --- | --- |
| Backend worker | F2/F4/B1/B3/B5/B6/B7 and related tests | Shared pair validity; preserve per-path rules, atomic SQL upserts, fresh RBAC checks and cleanup asymmetry |
| Profile/API worker | F1/W1–W4, then B4 resources/signing | Exact request attribution and strict canonical/session guards; distinct cache tag subsets and viewer keys; legacy avatar-path semantics |
| Lifecycle/UI worker | W7/W8, mounted-ref W9, touched-test T1, then T2/T3 | Explicit search reset, per-instance IDs/state, opt-in polling, caller-specific cookie requirements and isolated fixture guards |
| Main agent | PostgreSQL evidence, temporary isolated API/production bundle/browser configuration, integration and final plan status | No development database or stack reset; uniquely prefixed fixtures and explicit non-skipped browser results |

The explorer deferred optional B2 pagination abstraction, W5 action-hook consolidation, W6 presentation wrappers, count-label W9 and W10 menu rendering because their differing contracts would add more indirection than the small repetition warrants. F3 remains a separate lifecycle/race design issue. F5 remains separate artifact hygiene; tracked output files stay untouched.

### Integrated explorer review and repairs

After all workers released their source, the explorer reviewed the complete combined diff and new files against the plan and each worker's contracts. It checked constructor callsites, exact slug attribution, shared PHP/SQL validity expectations, state/block authority, resource fields and signing, viewer-partitioned cache keys, distinct invalidation subsets, search/dismissal reset, mounted callbacks/timer cleanup, and the test harness's isolation boundaries. It found no remaining blocking implementation error and required no repair from that pass.

During integration, TypeScript findings were repaired before acceptance: readonly tag tuples are spread where RTK expects mutable arrays, and Dashboard retains a stable non-null username inside its callbacks. The touched bell polling test's existing unwrapped-update warning was repaired. The main agent also added real-browser `bjørn` and `straße` username-change/redirect regressions, preserving the private Friends suffix, query and hash through the actual API and production build.

### Final verification

| Check | Result |
| --- | --- |
| Full backend Pest, explicit SQLite `:memory:`, PHP memory 2G | **1,125 passed, 35 skipped; 6,179 assertions** (1,160 total) |
| Full frontend Vitest | **1,247 passed across 125 files** |
| TypeScript `npm run typecheck` | Passed, including E2E helper/spec types |
| Production frontend build | Passed; existing large-chunk advisory remains |
| Full ESLint | Zero errors, five existing warnings outside this feature |
| Full Pint | Passed |
| Full configured PHPStan, sequential `--debug` | Passed, zero errors; the earlier normal-invocation failure was not reclassified as a pass |
| Extended PostgreSQL 17.11 driver checks | Passed: ten projection shapes; voice-only eligibility; mixed admin/super_admin exclusion; repair validity/idempotency/rollback; Unicode and literal search; tied-date pagination; independent-process service contention |
| Isolated real Chromium + WebKit workflows | **14 passed, zero skipped, unexpected or flaky**; seven workflows in each browser |
| Scoped mobile axe/keyboard/reduced-motion/overflow checks | Passed; retained WebKit mobile screenshot visually inspected |
| Diff whitespace and root driver PHP syntax | Passed |

The browser workflows exercised real form login/logout and separate sender/recipient contexts, request acceptance/decline, pagination/cached-page return/search, administrative target rejection, private/nonowner/anonymous behavior and session expiry. The new canonicalization workflows changed a fresh fixture's username through the API before visiting its transliterated alias. These checks cover the affected Friends/profile flows; they are not a rerun of every unrelated browser suite, external media service or physical mobile-device test. The full Vitest run still emits existing `act(...)`/Base UI warnings in other tests; no suite failed.

PostgreSQL evidence used `en_US.utf8`, 2,000 new performance-fixture people, viewer degree 600 and 41,200 new directed performance edges. Accepted nonempty pages measured **four queries** (previously five); nonempty discovery remains three. Both crossed-request workers were observed waiting on the same advisory lock before release. Accept/decline was exercised in both participant-ID orientations with separate backend PIDs. All reconciliation evidence ran inside an outer transaction and was rolled back, preserving prior disposable fixtures. This verifies the existing service locking protocol; the deferred reconciler absent-row concurrency problem and full-account erasure race remain unresolved by design.

Evidence and the temporary wrapper/config/build are retained at `/private/tmp/speechcoach-dry-friends-9e6w6t0n/`, including `postgres-evidence.json`, `pest-full.log`, `vitest-full.log`, `phpstan.log`, `eslint.log`, `build.log`, `playwright.log`, `browser-results.json` and `mobile-webkit.png`. The isolated database is in the separately created container `speechcoach-dry-friends-9e6w6t0n` on loopback port 15435; API/preview used ports 18080/5174. Only this verification environment was migrated and seeded. No development database reset, deployment, artifact removal, staging or commit was performed.

After verification, the temporary API and preview processes and that exact PostgreSQL container were stopped. Its database and all evidence files remain available; `docker start speechcoach-dry-friends-9e6w6t0n` can resume the retained isolated database. No container/volume or workspace files were deleted.
