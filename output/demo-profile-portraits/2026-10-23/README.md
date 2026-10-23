# Development profile portraits

Seven distinct, fictional, photorealistic headshots generated with the built-in image_gen tool using the imagegen skill on 2026-10-23. These are demo images, not photographs of the account holders. Exact per-person prompts and the installed storage paths are recorded in [manifest.json](manifest.json).

| Account | Source portrait | Profile |
| --- | --- | --- |
| Test2 Test2 | [33-test2.png](33-test2.png) | https://app.speechcoach.test/u/test2 |
| Sadie Superadmin | [9001-sadie.png](9001-sadie.png) | https://app.speechcoach.test/u/e2e-super-admin |
| Adam Admin | [9002-adam.png](9002-adam.png) | https://app.speechcoach.test/u/e2e-admin |
| Cora Coach | [9003-cora.png](9003-cora.png) | https://app.speechcoach.test/u/e2e-coach |
| Milo Member | [9004-milo.png](9004-milo.png) | https://app.speechcoach.test/u/e2e-member |
| Bram Bystander | [9005-bram.png](9005-bram.png) | https://app.speechcoach.test/u/e2e-coach-b |
| Cyrus Cutoff | [9006-cyrus.png](9006-cyrus.png) | https://app.speechcoach.test/u/e2e-coach-c |

## Installation and verification

Installed only in the existing local `speechcoach` database. All seven profiles previously had null avatar paths. The application's existing `AvatarProcessor` re-encoded each source to a 512 × 512 JPEG and stored it under a fresh `avatars/{user_id}/{ulid}.jpg` key in SeaweedFS. One database transaction updated the seven `profiles.avatar_path` values and their normal `updated_at` timestamps. All other profile columns and every user row were verified unchanged. No seeder, application source, service configuration or dependency was changed.

All seven actual signed image URLs returned HTTP 200 with bytes matching the stored JPEG hashes. All seven actual public-profile API responses returned HTTP 200 with the assigned avatar URL. These are direct API/storage checks; no browser UI test was run.

Open or refresh a profile above, or its owner's Edit profile page, to see the image. Existing connection cards also consume profile photos. Reviewer-directory rows show names without rendering photos.

## Header display repair

The original image installation populated profile data; the account header still rendered initials. A subsequent repair connects `UserMenu` to the existing cached public-profile query, requires the returned user ID and username to match the active account, and displays the photo inside the existing circular chip. Missing or failed images retain the colored initials. Avatar uploads refresh the shared profile cache, and switching accounts removes the previous account's photo while the new profile loads. The identity API and database schema are unchanged. Refresh an already-open app tab to load the repaired header.

## Recovery and lifetime

[profile-avatar-backup.json](profile-avatar-backup.json) preserves the seven original profile rows. The original avatar paths were all null. The manifest identifies the exact generated object associated with each account, so restoration can be limited to those references without deleting media. Existing media was not replaced or deleted.

This populates current development data. Resetting/reseeding that database can remove these assignments; the existing seeders were intentionally left alone. Keep the source images and manifest here for reuse. Nothing was committed.
