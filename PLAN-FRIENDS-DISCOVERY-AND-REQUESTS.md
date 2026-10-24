# Friends, people search and connection requests

Status: implemented and independently reviewed on 2026-10-23 following the user's explicit implementation request. Created against clean HEAD `cad96e4a1cacc659aa0c2179e65112f7b0375220`. Sections 1–12 retain the design/planning baseline; section 13 records execution, reviewed repairs and validation.

## 1. Requested result and confirmed privacy boundary

Add a **Friends** section to the signed-in person's own profile. It opens their accepted connections, with photographs, names and mutual-friend counts. Selecting an accepted person's name/photo opens their profile.

Provide three destinations within that section:

| Destination | Initial content | Primary interaction |
| --- | --- | --- |
| Your friends | First page of accepted connections | Search names; open a friend's profile |
| Friend requests | Incoming pending requests | Accept or Decline |
| Find friends | Empty results panel with a search prompt | Enter a name, press Enter or Search, then Send request |

The user explicitly confirmed that **Find Friends results must have no profile links**. Public `/u/:username` profiles remain public. This is a presentation boundary on these results, not a new profile authorization policy. Do not promise that an unconnected person's profile is inaccessible elsewhere.

**Explicit user requirement: nobody may find or friend an admin or superadmin account.** Accounts carrying either `admin` or `super_admin` are excluded from every Friends/people search result, accepted-friend list, incoming-request list and mutual-friend count, even if they also carry member/coach roles. Enforce this on the server before pagination/counting, not by hiding downloaded cards. Reject friend creation or acceptance involving either administrative role through every entry point, including a direct API request with a known user ID and a stale search result after a role promotion. This restriction concerns social discovery/connections; it does not remove authorized administrator account-management searches or change the confirmed public-profile policy.

Only the viewer's own list and incoming requests are exposed. Other people's full connection lists remain private. Mutual counts are aggregate integers, never lists of mutual identities. A friendship grants no speech, recording, annotation, transcript or review access.

Use “Friends” in the new interface; retain the existing `connections` table, state machine and mutation URLs. No second relationship model is needed. This plan does not add messaging, recommendations, birthdays, contact importing, an outgoing-request management screen, or a global public people directory.

## 2. Source findings from the explorers

The frontend and backend were explored separately and the main agent cross-checked the source. References below describe this checkout, rather than guarantees from older design documents.

| Source | Verified behavior and implication |
| --- | --- |
| `web/src/App.tsx:104`; `web/src/routes/PublicProfile.tsx:115` | Public profiles are outside `AppLayout` and use real routed navigation links and an outlet. They do not inherit the dashboard sidebar, its companion provider, or its protected-route behavior. |
| `web/src/routes/PublicProfile.tsx:128` | The current rail/outlet layout constrains content to roughly 36.25rem. Friends needs a full-width content branch. |
| `web/src/components/profile/ConnectionsRail.tsx:43` | The rail displays the **viewer's** first accepted page, even on another person's profile. Its tiles are not links; “See all” is inert; its count is only page length. |
| `web/src/components/layout/ConnectionRequestsBell.tsx:31` | The existing header entry already fetches incoming requests and accepts/declines them. Its badge is page length and failures are not presented. Preserve this entry point while making it consistent with the new page. |
| `web/src/features/connection/connectionApi.ts:39` | One existing RTK Query slice owns connection reads/mutations. List queries currently have void cache keys; invalidation is incomplete for the new surfaces. Extend this slice. |
| `web/src/components/auth/UnauthenticatedRedirect.tsx:87` | Every `/u/` descendant is currently treated as public on a 401. The new private child needs an explicit exception; public profile roots must stay public. |
| `web/src/features/annotation/commentaryPreferenceSession.ts:9` | An existing middleware demonstrates identity-change cache cleanup. Connection data needs its own equivalent, with realistic store tests. |
| `api/app/Http/Controllers/Api/ConnectionController.php:111` | Existing accepted and incoming lists use 20-row timestamp/id cursor pages. `state=pending` excludes outgoing requests. Current responses have no total. |
| `api/app/Services/ConnectionService.php:54` | Atomic mirrored upserts support new requests, repeat requests, declined-to-pending retries and crossed requests resolving to accepted. Preserve those semantics. |
| `api/app/Services/ConnectionService.php:89,127,223` | Accept/decline lock the actor's row before acquiring the ordered pair. That conflicts with the service's lower-owner-first invariant and can deadlock under real concurrent PostgreSQL traffic. |
| `api/database/migrations/2026_08_30_100001_create_connections_table.php:106` | Existing unique owner/peer and owner/state/time indexes support the core list and relationship lookups. Two mirrored rows represent one relationship. |
| `api/app/Models/User.php:84` | Reviewer discovery has different semantics: member/coach roles, plain `LIKE`, separate first/last/username matching, and insufficient social eligibility filtering. Do not use it directly as friend search. |
| `api/app/Http/Resources/PublicProfileResource.php:39`; `ConnectionResource.php:40` | Public profiles prefer display name, while old connection resources concatenate first/last. New cards need one explicit display/search rule. |
| `api/app/Models/User.php:169`; `Services/Privacy/AccountErasureService.php:223` | User moderation deletion is not an automatic SoftDeletes scope. Full erasure removes connections but leaves an anonymized user row. Filter candidates and mutual people explicitly. |
| `api/app/Http/Requests/Connection/CreateConnectionRequest.php:18` | `exists:users,id` alone does not reject admin or inactive targets. Discovery exclusions need matching write-boundary enforcement. |
| `api/app/Providers/AppServiceProvider.php:400` | Admin-tier participation is intended to be prohibited, but only blocking has a specific connection Gate. Do not rely on a blanket admin Gate override to enforce new restrictions. |
| `MODERNIZATION_PLAN.md:1100–1102` | The existing privacy discussion distinguishes private connection lists from permitted mutual connections/counts. Add counts without publishing someone else's nonmutual graph. |

Current behavior is not browser-tested as part of this planning task. The existing test suite is useful future validation, not evidence that a new feature already works.

## 3. Routes, ownership and navigation

Use routed links, not ARIA tabs pretending to navigate documents:

- `/u/:username/friends` redirects with replace to `/u/:username/friends/all`.
- `/u/:username/friends/all` — accepted list, default destination.
- `/u/:username/friends/requests` — incoming requests.
- `/u/:username/friends/find` — submitted people search.

Show the profile's **Friends** navigation link only when fresh, successful `/api/me` and current profile data establish the same canonical ID, comparing `String(me.user.id)` with `String(profile.id)`. Also require a usable canonical username and a non-admin actor. Preserve the existing three profile links for anonymous/nonowner viewers.

Wrap every Friends child in a focused owner/session guard. Wait during identity revalidation, fail closed on errors, and never render the previous person's data while changing usernames or accounts. Use `currentData` for username-keyed profile results and validate canonical username before using them. A nonowner direct visit gets a local unavailable/404 view with no private queries; anonymous direct visits go to login with a return destination. Client checks are usability guards: all APIs derive ownership from the authenticated session, never the URL's username.

Render Friends content across the available profile width, without the repeated narrow rail alongside it. Keep the existing profile identity/header and Back to dashboard link. On other profile sections, retain the viewer's rail but label it **Your connections**, make accepted tiles clickable, and link **See all** to the viewer's own Friends page. Do not imply it is the viewed person's list. Skip private queries entirely until a current eligible identity is established.

The header request popover remains usable, with a **View all requests** link to the signed-in person's Friends/requests route. That link remains available when a successfully loaded list is empty. The bell, rail, Friends page and profile relationship action all use the same current eligible-viewer rule: unresolved/stale identity, missing username, admin tier or auth error means no private query/action. Hide the bell from ineligible identities rather than repeatedly issuing a forbidden query. Existing Your profile navigation already provides an entry point; a new dashboard sidebar destination is unnecessary for this iteration.

## 4. Presentation and interaction

### Accepted friends

Use a responsive semantic list of photo/name cards: two columns where space permits, one on narrow screens. A single name/photo link per card opens `/u/{encoded username}`. Do not wrap action buttons in that link. Show `0 mutual friends`, `1 mutual friend`, or `N mutual friends` truthfully; the old review-collaboration metric is not a mutual count.

A labeled name-search input filters accepted friends across the **entire server-side list**, not only the 20 downloaded rows. Debounce this input by approximately 300ms; Enter/Search also applies it immediately. Clear restores all accepted friends. Changing the search resets pagination. Display the matching total from the server and distinguish “No friends yet” from “No friends match this name.”

### Incoming requests

Use photo cards containing requester name, mutual count, optional existing note, and **Accept** / **Decline**. “Decline” means changing connection state, not deleting a user or account. Only incoming pending requests appear. For this iteration requester names/photos need not link to profiles; the accepted list becomes the clear navigation surface after acceptance.

Mutations have independent per-card busy/error state. Call `.unwrap()` and render failures. On success, remove or reconcile the card and announce the action. Move focus to the nearest remaining action or a stable results heading when the acted-on card disappears. Never disable unrelated cards simply because one request is being handled.

### Find friends

Maintain distinct draft-input and submitted-search state. Initially, and after clearing, render “Enter a name to find people” with no people-query request. A native search form supports **Enter** and a visible **Search** button. Typing alone must not query or populate results. A trimmed nonempty submission starts the search and resets pagination; pagination continues using the submitted value, not unfinished draft text.

Return sendable people only: exclude self, accepted connections, incoming/outgoing pending pairs, blocked pairs in either direction, and ineligible accounts. Existing declined relationships may be requested again. This intentionally does not add an outgoing requests list; show a successful-send status even if refreshed results remove that card.

Result cards have image, displayed name, mutual count and **Send request**. No profile anchors, image links, card click handlers, View profile buttons, or profile-navigation keyboard actions. Plain names/photos remain noninteractive. Omit usernames/profile URLs from the discovery response; this reduces accidental linking, while numeric IDs still identify mutation targets and are not secrets.

After sending, respect the returned canonical state: pending → “Request sent”; accepted after a simultaneous crossed request → “You are now connected.” Refresh lists/counts/search. Prevent repeat clicks while pending. A stale result can become blocked/ineligible or disappear: show a neutral unavailable message and refresh rather than claiming success. Handle 401, 403, 404, 409, 422, 429 and network/5xx errors distinctly enough to give a useful recovery action; preserve the existing CSRF retry wrapper.

### Theme, photographs and accessibility

Reuse local Rehearsal Notebook paper/cream, ink, teal controls, burgundy headings and subtle panel borders. Apply opt-in notebook surface classes to the Friends region; do not globally restyle public profiles. Profile pages are outside `AppLayout`, so explicitly import the scoped style dependency rather than assuming it is inherited. Reuse an existing compact `profile` or `reviewers` illustration in the heading if it fits; no new character assets, animation system or art-provider dependency is required.

Images have reserved square dimensions and `object-fit: cover`; lazy-load below-the-fold cards. A new local person-avatar wrapper handles missing, failed or expired image URLs with a neutral fallback, resets the failed-image state when the URL changes, and uses empty alt text when the adjacent name already names the person. Preserve the existing header avatar implementation. Avoid changing the shared Avatar component merely to implement these local states.

Use visible labels, real links/buttons, list semantics, polite result/action announcements, non-color-only statuses, visible focus, and wrapping long names. Preserve natural heading order and keyboard order. Loading, empty, errors, refresh and pagination are explicit states. Test at 375px and desktop widths, with reduced motion and keyboard-only operation.

## 5. Backend contract and eligibility

Keep existing mutation endpoints and the old `/api/connections` list/rail contract intact. Add dedicated read endpoints to avoid coupling mutual counts to the rail's review aggregate.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/friends` | `view=accepted` (default) or `incoming`; optional `search` on accepted; opaque `cursor` | `{friends: [...], meta: {total, next_cursor}}` |
| `GET /api/friends/find` | Trimmed `search`; opaque `cursor` | `{people: [...], meta: {next_cursor}}`; blank/missing search returns an empty array without a broad people search |
| `GET /api/friends/relationship/{user}` | Target user ID | Viewer-scoped relationship projection for the existing public-profile connection action; no graph/list of another user's relationships |

Register literal `/friends/find` and `/friends/relationship/{user}` routes explicitly. Neither may be swallowed by a generic model-bound Friends route. Use `auth:sanctum` and existing API activity handling. Do not change verification/onboarding rules globally as part of this feature.

Friend list entry: `{connection_id, person: {id, name, username, avatar_url}, mutual_friends_count, requested_at, connected_at, note}`. Connection IDs always refer to the viewer's own mirrored row. Accepted uses `connected_at`; incoming uses `requested_at`, and existing note may be shown. Nullable times must be handled deliberately rather than producing broken cursors.

Find entry: `{person: {id, name, avatar_url}, mutual_friends_count}`. It is a sendable-at-read-time guarantee, not a promise that relationship state cannot change before POST.

Relationship projection: `{relationship: {state: 'none'|'pending'|'accepted'|'unavailable', direction: 'incoming'|'outgoing'|null, connection_id: number|null, connected_at: string|null}}`. Return accepted/pending only from a valid reciprocal pair, and only the viewer-owned ID. A wholly absent pair or a valid declined pair maps to none; keep declined row IDs out of that projection. Blocked/ineligible/asymmetric targets get a generic unavailable projection, without exposing who blocked whom. A self target is unavailable; the existing no-self UI and service check remain. This replaces the public-profile action's first-20-accepted-rows lookup, so friends beyond page one display Connected and pending requests do not misleadingly display another Send action. Preserve the existing Connected since date and block action using `connected_at` and the viewer-owned `connection_id`; display block failures and keep the dialog retryable rather than closing on every failure. Incoming can link to the viewer's requests page; outgoing shows Request sent. Anonymous profile rendering must skip this authenticated lookup. Loading/error/unavailable are never treated as a sendable none state.

Create a focused reusable eligibility/query helper. Named searchable people require nonblank username and a usable displayed name, no `suspended_at`, `deleted_at` or `anonymized_at`, and no role in `Role::ADMIN_TIER`, including mixed-role accounts. Roleless accounts are allowed when otherwise eligible. Do not require explicit member/coach assignment. Do not reuse `erasure_started_at` as a blanket account-inactivity predicate: that stamp also participates in the narrower voice-erasure workflow.

Enforce non-admin/active actor eligibility for new reads and relationship creation/acceptance. At write time re-read the target and reject admin/inactive targets, rather than trusting a discovery result. Require a usable identity for newly requested/accepted relationships; update the affected tests' local identities explicitly instead of changing the global UserFactory or real data. Preserve self-request 422 precedence and owned-row 404 behavior. Cleanup actions such as decline/block must still allow an eligible actor to sever an existing connection to an inactive or newly promoted admin peer. Avoid exposing sensitive reasons in target-unavailable errors.

Use direct service-boundary checks for participation, so internal callers and the existing POST route cannot bypass them. If an implementation instead introduces Gate abilities, every new restrictive ability must also enter `$mustFallThrough`; a blanket admin override must never turn the denial into an allowance. Do not alter unrelated policies.

## 6. Search, pagination and mutual count correctness

Define one displayed/searchable name: nonblank trimmed `profiles.display_name`, otherwise trimmed first-name + space + last-name. Search this expression case-insensitively, including full names, with literal substring semantics. Normalize outer whitespace; do not promise accent-insensitive matching or transliteration. Allow any nonempty query up to 100 Unicode characters. Validate scalar parameter types/length. Use bound parameters and an explicit escape character, e.g. `!`: escape `!` as `!!`, `%` as `!%`, `_` as `!_`; a backslash is then a literal rather than an implicit escape. Use explicit SQL `LOWER(name-expression) LIKE LOWER(?) ESCAPE '!'` or a verified driver equivalent. Verify both the names and query are folded, and display the original-case name. PostgreSQL and SQLite must have deliberate equivalents, not an assumption that their default LIKE/collation behavior is identical. PostgreSQL Unicode case behavior follows its configured locale; record it and verify representative non-ASCII names on that actual driver. SQLite's built-in LOWER is not Unicode-equivalent: its ASCII tests alone are insufficient release evidence. No new accent-folding/transliteration promise is introduced.

Serve 20 rows, fetch one extra for continuation. Accepted/incoming keep descending `(connected_at,id)` / `(requested_at,id)` ordering. Discovery uses ascending user ID for a stable first iteration; alphabetical ranking is not promised. Search changes reset cursors. New cursors are versioned, validate types/timestamps/positive IDs, and are bound to view, normalized query and viewer. Malformed, cross-view, cross-query or cross-viewer cursors return 422; base64 is encoding, not authorization. Never serialize a timestamp differently from the value used in the seek predicate. Treat malformed historical rows without sort timestamps as excluded and flag them for reconciliation; do not silently invent time ordering.

`meta.total` on friend lists counts all eligible matches before the cursor, rather than downloaded rows. The rail and bell consume those accurate totals after migration to the new read hooks. Discovery only needs continuation and must not issue an expensive full-candidate COUNT solely for a decorative total.

For each page, calculate shared accepted friends in **one grouped aggregate for the displayed candidate IDs**. Let M be a shared person: viewer↔M and candidate↔M must both be reciprocally accepted. Count distinct M once. Exclude self/candidate, ineligible shared people, pending/declined/blocked edges and asymmetric/corrupt pairs. Missing aggregate rows mean integer zero. Do not load the entire social graph or expose shared IDs/names in JSON.

List acceptance and blocking also fail closed on inconsistent mirrors: accepted list requires both directions accepted; incoming requires both directions pending with consistent nonself initiator; discovery excludes either direction blocked/accepted/pending and only offers a wholly absent pair or valid declined pair. Relationship projection gives unavailable for inconsistent pairs. Keep the existing asymmetry reconciler; read paths must not repair rows as a side effect.

Fix the relevant existing lock-order issue before relying on parallel UI actions: in accept/decline, look up ownership/peer without taking the high row's lock first, then acquire both rows lower-owner-first, revalidate the selected row/initiator/state inside the transaction, and apply the existing transition. Missing rows from concurrent erasure fail safely. Keep request upsert atomicity and do not invent a new auto-accept algorithm.

Apply the same reciprocal-state safety to **writes**, not only reads. Before accepting or requesting an existing pair, validate both mirrored states/initiator/blocker under a consistent transactional strategy. Either blocked edge prevents acceptance or a successful new request; corrupt/missing-one-side/mismatched pairs return a controlled conflict and are left for reconciliation. Preserve wholly fresh paired inserts and valid crossed-request acceptance. Request's existing post-transaction check of only the requester's row is insufficient: inspect both rows and throw inside the transaction so invalid partial changes roll back. A post-upsert check alone cannot prove a pre-existing corrupt pair was valid, because some corrupt inputs can be transformed into a seemingly valid pair. The implementation must therefore preserve/check the pre-transition invariant safely while retaining atomic upserts for concurrent fresh inserts; do not substitute a racy select-then-insert algorithm. Test accepted/blocked and pending/blocked permutations with either actor ID ordering. Decline must never clear the opposite side's block, while the existing explicit block/unblock transitions retain their documented behavior.

## 7. Cache, session and refresh design

Extend `connectionApi`, not a second API slice. Add typed friend-list, discovery and relationship queries and broad tags covering all paged lists/counts/discovery/relationship projections. Mutations request/accept/decline/block/unblock invalidate all affected connection views, including old rail/pending queries. Broad invalidation within this domain is preferable initially to stale mutual counts and complex optimistic graph updates.

New query cache arguments include the resolved viewer ID plus view, normalized submitted search, cursor and target where appropriate; viewer ID is cache partitioning only and is not sent as a server authorization override. Render `currentData`, not a prior argument's cached result. Reset connection API state on login/getMe identity changes, successful logout, auth reset, and getMe 401 using focused session middleware registered in the actual app and test stores. Do not import the singleton store into the API slice. Test old responses resolving after reset/account change; they must never become the new viewer's data or trigger actions against the wrong person.

Do not copy the annotation middleware's raw matchFulfilled-payload approach without handling obsolete authentication responses. A getMe request begun before a logout/new login can complete late: an old fulfilled action must not restore the old connection identity. Track accepted authentication request IDs/session generations, and gate every connection consumer on the current generation and matching current viewer. If a small connection-session state/reducer is needed, keep it in the new connectionSession module and register it in the owned store/test-store files. Cover late auth responses as well as late connection responses, including logout → account B login → account A's old getMe fulfillment. Noncurrent generation results remain hidden and provoke fresh authoritative session resolution rather than becoming eligible through cached `me` alone.

Adjust `UnauthenticatedRedirect` to recognize exactly the private `/u/:username/friends` route family before the broad `/u/` exemption. Keep anonymous About/review profile routes public and avoid query-reset/refetch loops. A Friends-list 401 must clear protected data and leave the private view even if `/api/me` is still cached. Preserve 419 handling and real login return destinations. On non-401 identity failures show a retryable error and keep private data/actions hidden.

Upgrade the rail and request bell to the new accepted/incoming query contracts; keep legacy endpoints available for compatibility and their existing review-metric tests. The rail's label/count/tile behavior changes to the new Friends semantics. PublicProfile uses the targeted relationship lookup instead of depending on that page of rail rows.

Use refetch-on-mount for management pages and a cleanup-safe visible-window focus/visibility refresh for current connection queries. The requests bell should also refresh incoming data while visible, e.g. a modest 60-second poll with hidden-tab polling disabled, so another session's request is discoverable without a hard reload. Do not silently introduce global focus listeners or polling for every unrelated API. While refresh is in flight, prevent stale action submission or reconcile current server state; pending incoming/outgoing discrimination must not rely on an old rendered array.

Name/avatar updates originate in a separate API slice. Add narrowly targeted cross-slice invalidation of friend lists/discovery/relationship projections after successful profile identity/username/avatar updates; test it. Handle expired signed image URLs by refresh on remount/focus and an image fallback, without retry loops or storing signed URLs as permanent identity data.

After relationship-changing mutations, restart affected cursor navigation from page one and deduplicate by person/connection ID. Do not concatenate pages from different searches, viewers or relationship snapshots. Preserve submitted Find search across an ordinary refetch; on account change clear its draft/results/mutation statuses.

## 8. Performance decisions and limits

- Existing connection indexes are the starting point. No migration, extension installation, new table, denormalized counter or search service is required for the initial implementation.
- Eager-load profiles, avoid per-card role/relationship lookups, sign avatar URLs using the existing MediaUrlSigner without per-image object-storage existence calls, and batch mutual counts for only the page.
- Counts, eligibility checks and reciprocal-edge conditions must be set-based. Assert fixed query growth for one versus twenty results; do not merely count a particular SQL substring while allowing hidden N+1 queries elsewhere.
- Name substring search can scan users/profiles even with LIMIT 20. Existing username indexes do not solve `LOWER(display-name-expression) LIKE '%term%'`. Record this as a real scaling cost. Enter-only Find submission, query bounds, paging, and a caller-scoped read limiter reduce load but do not make the scan indexed.
- Add a dedicated read limiter for new Friends endpoints (initial proposal 120/minute per authenticated caller), separate from the existing 5-per-pair/day send limiter. Test 429 without weakening existing limits. Account for the bell and focus refresh in the read budget.
- Later implementation validation must run PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` on an isolated realistic dataset with high-degree viewers, name misses and common names. Compare scanned rows, total time and spills for lists/counts/mutual aggregation. The existing script verifies review timelines, not this new search query.
- If measurements justify `pg_trgm`/GIN, a stored normalized search field or an additional accepted-edge covering index, stop and propose a separate evidence-backed index migration. Do not install an extension or change production schema opportunistically. The plan's initial no-migration choice does not promise unbounded scale.

## 9. Implementation tasks and exclusive file ownership

These are future tasks for an implementation request. New filenames are proposed; verify collisions before starting. Assign one worker to each task and do not let two workers edit the same path. Run dependencies in order; if source no longer matches this plan, stop and report the mismatch.

| Task | Exclusive file ownership | Dependencies and completion criteria |
| --- | --- | --- |
| T1 — server queries/contracts | New `api/app/Services/FriendDirectoryService.php`, `api/app/Support/ConnectionEligibility.php`, `api/app/Http/Requests/Connection/ListFriendsRequest.php`, `api/app/Http/Requests/Connection/FindFriendsRequest.php`, `api/app/Http/Resources/FriendResource.php`, `api/app/Http/Resources/FriendCandidateResource.php`, `api/app/Http/Controllers/Api/FriendController.php`; existing `api/routes/api.php`, `api/app/Providers/AppServiceProvider.php` | Define final payloads/cursors, eligible reads, batched counts, direct actor checks, limiter/routes. Preserve legacy route contracts and public profile route. |
| T2 — mutations and concurrency | `api/app/Services/ConnectionService.php` | After T1 helper contract. Request/accept participation guards, ordered pair locking in accept/decline, preserve state machine and cleanup semantics. No other policies rewritten. |
| T3 — backend regression evidence | New `api/tests/Feature/Connection/FriendDirectoryTest.php`, `api/tests/Feature/Connection/FriendDirectoryQueryCountTest.php`; existing `api/tests/Feature/Connection/ConnectionHttpTest.php`, `api/tests/Feature/Connection/ConnectionServiceTest.php`, `api/tests/Feature/Privacy/AccountErasureServiceTest.php`; new `scripts/verify-postgres-friends.php` for isolated PostgreSQL checks if needed | After T1–T2. Local named test fixtures, including names for the three account-erasure test participants that call ConnectionService; role/eligibility/graph/cursor/errors/query-count cases; actual PostgreSQL concurrency evidence distinct from SQLite tests. Do not change global factories or existing seeders. |
| T4 — client API and identity cache | Existing `web/src/features/connection/connectionApi.ts`, `web/src/features/connection/types.ts`, `web/src/app/store.ts`, `web/src/test/renderWithProviders.tsx`, `web/src/features/profile/profileApi.ts`; new `web/src/features/connection/connectionApi.test.ts`, `web/src/features/connection/connectionSession.ts`, `web/src/features/connection/connectionSession.test.ts`, `web/src/features/profile/profileApi.test.ts` | After T1–T2 contracts. New hooks/tags/scoped keys, cross-slice identity refresh and connection cache teardown. Preserve existing exports for other consumers. |
| T5 — Friends page/components | New `web/src/routes/ProfileFriends.tsx`, `web/src/routes/ProfileFriends.test.tsx`, `web/src/components/profile/FriendPersonCard.tsx`, `web/src/components/profile/FriendPersonCard.test.tsx`, `web/src/components/profile/FriendPersonAvatar.tsx`, `web/src/components/profile/FriendPersonAvatar.test.tsx`, `web/src/components/profile/friends.css` if existing scoped utilities cannot express the design | After T4. Three routed views, owner/session guard, correct submit semantics, accessible states, pager, actual server-state reconciliation, theme. No shared global Avatar/UI component edits. |
| T6 — route/profile integration | Existing `web/src/App.tsx`, `web/src/routes/PublicProfile.tsx`, `web/src/routes/PublicProfile.test.tsx`, `web/src/components/profile/ConnectionsRail.tsx`, `web/src/components/profile/ProfileConnectionAction.tsx`; new `web/src/components/profile/ConnectionsRail.test.tsx`, `web/src/components/profile/ProfileConnectionAction.test.tsx` | After T4–T5. Owner-only nav, full-width branch, safe anonymous behavior, current relationship projection, accepted profile links, real See all. Keep self-connect guard and original public sections. |
| T7 — header/session route entry | Existing `web/src/components/layout/ConnectionRequestsBell.tsx`, `web/src/components/layout/ConnectionRequestsBell.test.tsx`, `web/src/components/auth/UnauthenticatedRedirect.tsx`, `web/src/components/auth/UnauthenticatedRedirect.test.tsx` | After T4–T6. New incoming query/true count, errors, view-all, scoped refresh, exact private-route 401 exception with public-route regression. |
| T8 — browser checks and final review | New `web/tests/friends.spec.ts`, new `web/tests/friends-fixtures.ts` if a dedicated helper is required; this plan's implementation-validation appendix only | After T1–T7. Isolated contexts/fixtures, main login, real backend workflows, mobile/accessibility and preservation checks. Never run a broad seed/cleanup against the user's development database. |

Tests that belong to a task travel with that task's exclusive paths. Resolve missing test paths before assigning workers; do not improvise edits to a second worker's files. No dependency/package upgrades, auth architecture rewrite, unrelated public-profile redesign, upload/media changes or application/development/production data insertion is in scope. Disposable, uniquely tagged validation fixtures are permitted only in an explicitly isolated test stack; future cleanup must target those exact fixtures and preserve existing users/connections. No fixtures are created during this planning task.

## 10. Acceptance and future validation

### Backend

- Anonymous new reads are 401; admin and super-admin, including mixed-role accounts, are denied; eligible roleless/member/coach accounts work. Viewer/owner overrides cannot expose another list.
- For each target role `admin` and `super_admin`, exact-name and partial-name searches in upper/lower/mixed case return no matching administrative account; list totals and mutual counts exclude it too. Repeat with member/coach mixed-role accounts. Direct send/accept attempts involving such targets fail without creating or accepting either mirrored row, including when promotion occurs after a search result was loaded. Existing administrative connections are hidden and cannot be reaccepted; cleanup remains possible without deleting account data.
- Accepted lists exclude pending/declined/blocked/ineligible/asymmetric entries. Incoming excludes outgoing and mismatched mirrored initiators. Counts and list membership use identical predicates.
- Find is empty for blank/missing/whitespace query and excludes self, either-direction blocks, current accepted/pending and invalid identities. Declined can be requested again. JSON contains no email, full third-party lists, mutual identities, or discovery profile links.
- Case variants, full names, display names, null/blank display-name fallback, literal `%`, `_`, escape character, duplicate names, oversized/scalar-invalid queries, non-ASCII documented behavior and zero matches are tested. Real PostgreSQL parity is required for case/escape behavior.
- Twenty-plus rows, tied timestamps, nullable bad historical timestamps, last page, query/view/viewer-bound cursors and invalid cursor errors are covered.
- Mutual counts cover zero/multiple shared people, mirrored double-counting, invalid/inactive mutual accounts, blocking, missing mirrors and both required reciprocal paths. No review metrics are mistaken for mutual counts.
- Direct POST attempts cannot bypass self/admin/inactivity exclusions. Accept uses own incoming row and rejects outgoing acceptance; decline remains an explicit disconnect/reject transition. Either-side blocked/missing/mismatched pairs cannot be accepted or silently repaired by direct writes, invalid changes roll back both sides, and both actor-ID orderings are exercised. Existing rate limit and valid block/re-request/crossed semantics pass unchanged.
- Validate real PostgreSQL simultaneous crossed requests and accept/decline contention with two connections and a bounded lock timeout. Sequential SQLite tests are not proof of locking correctness. Any retries must follow existing transaction policy, not mask errors.
- Verify total query count stays bounded with page size, one mutual aggregate for each nonempty page, and no object-storage HEAD per person.

### Frontend and actual workflow

- Fresh login still works. Public anonymous profiles and original three sections remain reachable, owner gets Friends only, direct nonowner Friends URL never loads their data. Self Connect remains hidden for numeric/string IDs and during auth revalidation.
- Friends opens accepted cards; case-insensitive server search finds names beyond page one; photo/name navigates once to the correct profile. Rail See all and header View all requests go to the viewer's own route.
- Find sends no search on mount/typing; Enter/Search submits the trimmed name. Editing draft does not change current results or pagination. Every discovery image/name/card is non-navigable, including keyboard interaction.
- Independent sessions send → receive → accept → accepted-list navigation; sender sees pending or crossed-accepted response truthfully. Incoming card decline disappears; “Decline” does not delete an account. Another session's new request appears on the documented refresh interval.
- Errors/429/busy/refresh/focus/card removal/image failures/long names are readable and keyboard accessible. No nested link-button controls. Test 375px, desktop, reduced motion and axe on actual rendered states.
- Mutation invalidation updates all list pages, counts, discovery and profile relationship state. Profile/avatar changes invalidate these separate slice caches. Logout/401/account switch/cursor/search changes never show another viewer's private results, including late in-flight responses.
- Use real RTK/store middleware tests for cache isolation, not hooks mocked to a permanently current user. Confirm route tests update old exact three-link assertions only for authenticated owners.

Future commands, run from the named subdirectory with an isolated test environment:

1. `api`: targeted `php artisan test --filter=Connection` plus the new FriendDirectory tests; then the full `php artisan test`; Pint in check mode and PHPStan as configured.
2. `web`: targeted Vitest for changed routes/session/components, then `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
3. Dedicated real-stack Friends Playwright spec in separate browser contexts; retain the repository warmup/auth setup dependencies. Add a main-login smoke and public-profile smoke rather than assuming component tests prove auth still works.
4. PostgreSQL search/escape/query-plan/concurrency checks on disposable fixtures. Record dataset sizes and measured limits; do not reset the development database or overwrite real accounts.
5. Read-only reviewer compares implementation against every requirement/task, reads changed code, checks failure/authorization paths and test evidence, and reports gaps before completion. Repair reviewed defects within the assigned scope and rerun affected checks.

## 11. Consequences and implementation boundaries

Most infrastructure already exists; the substantive work is the owner-only UI, accurate paged read model, graph aggregate, cache/session isolation and concurrency/eligibility safeguards. This is a moderate feature spanning frontend and backend, rather than a navigation-only change. It needs no replacement storage or media pipeline and no new external service.

Mutual counts reveal aggregate social overlap, as requested; the server still does not publish full third-party lists. Public profiles remain reachable elsewhere. Admin/inactive participation guards deliberately close existing direct-write gaps and can make previously permitted invalid requests fail. Existing invalid rows are filtered or unavailable, not deleted or silently repaired. Search scaling remains measurable work; a schema optimization requires a separate supported decision if existing indexes prove insufficient.

Planning verification: separate frontend/backend exploration and main-agent source checks completed. Independent plan-vs-code review and resulting revisions are recorded below before this document is delivered. No application tests, browser runs, migrations or data changes are claimed by this planning work.

## 12. Independent review and corrections

An independent read-only explorer compared the draft with the current controllers, service, routes, middleware, schema and client components. The main agent checked the reported source locations and revised the plan as follows:

1. **Both relationship mirrors must be validated during writes.** Existing accept/decline logic trusts the lower row and request checks only its own row after commit. Added transactional pre/post-state validation, either-side block protection, rollback and both-orientation regression cases. Preserved fresh atomic crossed-request behavior.
2. **Preserve accepted-profile information.** Added `connected_at` to the targeted relationship response to retain Connected since and the accepted block action; explicitly mapped valid declined pairs to sendable none. Failure/loading states cannot become sendable by default.
3. **Account-erasure tests need usable identities.** Added exclusive ownership of `api/tests/Feature/Privacy/AccountErasureServiceTest.php` to T3. Its three service-connected participants need local names; a username alone is insufficient under the proposed rule. The global factory remains unchanged.
4. **Delegation paths are explicit.** Named every new test, conditional PostgreSQL script and browser fixture helper, and expanded abbreviated paths so workers cannot collide accidentally.
5. **Fixture scope is consistent.** Clarified that future disposable test fixtures are permitted in the isolated stack while application/development/production data insertion remains excluded.
6. **Identity gating includes the header and stale auth responses.** Required the same eligible-viewer gate for bell, rail, page and action; added session-generation/request-ID handling and tests for obsolete getMe responses after account changes.

Main-agent additional refinement: specified an explicit LIKE escape convention and PostgreSQL-versus-SQLite Unicode validation boundary. Performance findings and the evidence gate for any later index migration are captured in section 8.

The independent explorer re-read the revised plan and confirmed that all six findings were resolved, with no remaining material issues found in that review. This does not replace implementation-time testing.

The planning-stage document review checked source/path correspondence, task ownership, privacy clarification and preservation of the checkout. Those were design checks only; application implementation and test execution began after the subsequent explicit user request and are recorded below.

## 13. Implementation and validation — 2026-10-23

The subsequent implementation request authorized execution. T1–T7 were assigned to separate workers with exclusive file ownership; dependent implementation contracts were completed before downstream integration. T8 supplied real-stack browser fixtures and validation. The implementation provides the three own-profile Friends views, private paged queries, images/fallbacks, mutual counts, submit-only discovery without profile links, request actions, and the existing profile/rail/header integration. Public identity profiles and speech/review access rules are preserved.

The independent explorer compared the complete implementation with this plan and confirmed two administrative-discovery gaps. A repair worker fixed them, and the explorer independently checked the repairs and ran seven focused regressions (134 assertions), finding no remaining material issues:

- Legacy `GET /api/connections` and its incoming-request variant now reject administrative actors using fresh persisted roles and exclude administrative peers before pagination. The previous payload shape, review metrics and unnamed non-administrative legacy rows remain supported.
- `User::reviewerCandidates` now excludes either administrative role even when member/coach roles are also present. Search, credential filters and totals all apply this exclusion. Authorized administrative account-management searches are unaffected.

These required narrowly related additions to the original ownership matrix: `api/app/Http/Controllers/Api/ConnectionController.php`, `api/app/Models/User.php`, and the actual existing reviewer regression file `api/tests/Feature/Review/ReviewerDirectoryAuthorizationTest.php`. The initially suggested `ReviewerDirectoryTest.php` did not exist; the worker stopped and the main agent resolved the path before edits. `web/src/components/layout/AppHeader.test.tsx` also required a fixture-only update from the legacy pending-connections response to the new incoming-Friends response after the first full run exposed five outdated fixtures. No dependency, schema, global factory, seeder or unrelated product-flow changes were introduced.

Final validation:

| Check | Result |
| --- | --- |
| Full backend Pest, PHP memory limit 512M | **1,013 passed, 35 skipped; 5,608 assertions** (1,048 total) |
| Full frontend Vitest | **1,228 passed across 122 files** |
| Real Chromium and WebKit workflows | **10 passed, zero skipped/flaky**: five scenarios in each browser |
| TypeScript project checks and production build | Passed |
| ESLint | Zero errors; five existing warnings outside this feature |
| Full configured PHPStan | Passed, zero errors |
| Full Pint check | Passed |
| Independent repair regressions | Seven passed, 134 assertions |

Browser scenarios used actual form logins and separate browser contexts for sending/receiving/accepting/declining requests. They exercised initial accepted friends, repeated cached pagination, searching beyond page one, noninteractive submit-only discovery, mutual counts, administrative target search/direct-request denial, private/nonowner/anonymous behavior, real session expiry, and 375px keyboard/reduced-motion/axe checks. The mobile result was also visually inspected. The scoped axe checks cover the new Friends region, not an assertion of site-wide accessibility conformance.

The developer stack was already running on its usual ports. To preserve its data, validation used a separately created PostgreSQL 17 container, database `friends_verify` on `127.0.0.1:15435`, an API on port 18080 and a production-build preview on port 5174. Fixtures were uniquely named and guarded against execution on the development database; no broad reset or cleanup was used. A temporary Playwright configuration selected only these isolated tests with their own fresh form logins because the repository's shared setup hard-codes development origins/accounts. The existing Playwright configuration and its warmup/auth dependencies remain unchanged. Explicit IPv4 origins avoided an unrelated application listening on IPv6 localhost.

PostgreSQL evidence (`scripts/verify-postgres-friends.php`) established Unicode case/literal-character matching under `en_US.utf8`, tied-timestamp cursor continuation, and simultaneous independent worker contention for crossed requests and accept/decline in both actor-ID orientations. With 2,000 new people per run, viewer degree 600 and 41,200 directed edges per run, page reads retained fixed query counts (five accepted, three nonempty discovery, two discovery miss). Repeated evidence runs retained their uniquely named fixtures, roughly doubling the aggregate test graph. One cold discovery query measured **621.161 ms**; subsequent EXPLAIN execution measured **26.498 ms**, including **24.678 ms JIT compilation**, with no temporary spills. This is a measured cold/planner sensitivity, not a guarantee of constant latency. No index migration or extension was added automatically.

Evidence is retained under `/private/tmp/speechcoach-friends-verify.g79n0380/`, `/private/tmp/friends-postgres-evidence-final.json`, and the corresponding `friends-*-final.log` / `friends-browser-ipv4.log` files. After validation, the temporary API/preview processes and the specifically named temporary PostgreSQL container were stopped. Its database was disposable; the source verification script and browser fixtures permit recreation.

The reviewed local API image was rebuilt and only the `app` service refreshed. Its health endpoint returned OK and route inspection confirmed all three authenticated/rate-limited Friends endpoints. No development relationship fixtures were inserted. No commit or staging operation was performed.
