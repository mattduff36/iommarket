# Admin user and dealer profile editing

Status: implemented on the `staging` working tree at `599c4bb` (`merge: sync production release back into staging`). Not committed, pushed, or deployed.

The desktop Playwright scenario passed against a disposable fixture: rename, second edit, reload, user detail, public dealer page, listing seller, dealers row action, and a 390px-wide editor. Unit and component tests cover conflicts, rollback, account-only editing, cleared fields, and disabled accounts. The rollback test uses an in-memory transaction double. A failed write was not forced against the live database.

This is the first-release editor for another person's account and dealer profile. It is a reusable admin feature. It is not an Ocean Motor Village-specific fix and it does not write the database by hand.

No Prisma migration is required. Login email, credentials, ownership, roles, verification, subscriptions, preview classification, slug, logo, and avatar stay outside this release.

## Workspace boundary

Another chat is repairing database sync in this same working tree. Do not switch or reset branches, and do not edit database-sync code or its tests. At the start of implementation the unrelated dirty and untracked files were:

- `__tests__/components/database-panel.test.tsx`
- `__tests__/lib/database-sync-clone.test.ts`
- `__tests__/lib/database-sync-worker.test.ts`
- `__tests__/lib/database-sync-diagnostics.test.ts`
- `__tests__/lib/database-sync-merge.integration.test.ts`
- `app/(admin)/admin/database/database-panel.tsx`
- `lib/database-sync/clone-engine.ts`
- `lib/database-sync/columns.ts`
- `lib/database-sync/diagnostics.ts`
- `lib/database-sync/order.ts`
- `lib/database-sync/plan-counts.ts`
- `lib/database-sync/preflight.ts`
- `lib/database-sync/source-guard.ts`
- `lib/database-sync/types.ts`
- `docs/staging-transition/DATABASE-MERGE-REPAIR-HANDOVER.md`

`next-env.d.ts` may also be dirty from local Next tooling. Leave it alone.

Do not merge or deploy to `main` or production as part of this work. Release stays on the existing staging workflow.

Database sync copies `User.name` and `DealerProfile.name` by user id, not by display name. A later clone can overwrite a staging-only correction. `isAdminPreview` dealer rows are protected from sync overwrite. This editor does not change that.

## Gap

`updateDealerProfile` in `actions/admin/dealers.ts` was admin-only but had no UI caller. Its schema also accepted slug, logo URL, and `verified`. The update did not trim or clear optional fields, did not check `updatedAt`, wrote the audit after the update, revalidated only `/admin/dealers`, and returned raw errors.

`setUserRegion` can change a region and has no profile UI. Self-service `updateMyProfile` and `updateMyDealerProfile` update the signed-in user. `/dealer/profile` redirects `ADMIN` to `/admin`. An admin editing someone else must not call those actions.

`User.name`, `DealerProfile.name`, and `DealerProfile.slug` are different fields. The slug-history trigger runs only when `slug` changes. This release does not write `slug`, so it does not insert slug history and does not consume the dealer's self-service limit of 2 changes in 365 days.

## UI

One page, `/admin/users/[id]/profile`, shared by both entry points:

1. **Edit profile** on `/admin/users/[id]`.
2. **Edit dealer profile** in the `/admin/dealers` row actions. The link uses that row's `userId`.

The page shows who is being edited: email, user id, dealership name, dealer id, and the public path. Account and dealer fields are separate. Save is disabled until something changed. Cancel asks before discarding unsaved edits, and closing the tab does the same. A conflict asks for an explicit reload. It does not resubmit the stale form.

Deleted accounts see the restore message and no form. Disabled accounts can be edited. The page says that saving does not reactivate them.

## Field policy

The payload is strict. Unknown keys such as email, role, slug, logo, avatar, verified, tier, and `isAdminPreview` are rejected.

| Input | Meaning |
| --- | --- |
| Field omitted | Leave the stored value unchanged. |
| Optional phone, bio, website, or region sent as `""` or `null` | Clear it. Text becomes `null`. Region becomes `regionId: null`. |
| Field sent with a new value | Validate it, then update that field only. |

Names are trimmed, 2–100 characters, and cannot be cleared. A dealer-name-only edit must not write `User.name` or any other untouched field. Equal values are not written.

The dealer row is loaded by `DealerProfile.userId` for the selected user. A client `dealerId` is only a confirmation. If it does not match that row, nothing is written. Users with no dealer profile can still save account fields. Ordinary editing does not create a dealer profile, require a dealer timestamp, or change the user's role.

A submission with no actual changes does not write an audit row and does not revalidate.

## Concurrency and atomicity

The save takes a row lock, then updates only if the timestamp still matches. An ordinary read/compare/write inside a transaction is not the protection.

Inside one Prisma transaction, in this order:

1. `SELECT ... FROM "User" WHERE id = ? FOR UPDATE`
2. `SELECT ... FROM "DealerProfile" WHERE "userId" = ? FOR UPDATE`
3. Apply visibility and deleted-account checks.
4. If dealer fields were sent, require the locked dealer and an exact `dealerId` match.
5. Compare `updatedAt` with `expectedUserUpdatedAt`. Compare `expectedDealerUpdatedAt` only when dealer fields were sent.
6. Build the allowlisted diff. Validate a changed region against an active region.
7. `updateMany` each changed row with `updatedAt` in the `WHERE` clause. If `count` is not 1, throw.
8. Write `UPDATE_USER_PROFILE` and/or `UPDATE_DEALER_PROFILE` through `logAdminAction` on the same transaction client.

User changes, dealer changes, and audit rows commit together. Any failed check or write throws `AdminProfileEditError` inside the transaction so Prisma rolls back earlier writes. The action maps that error to a safe response after the transaction. It does not read a newer timestamp and retry.

Conflict copy: "This profile changed while the editor was open. Reload and try again."

Audit `details` contain only `fields`, `before`, and `after` for fields that changed. They do not contain email, auth ids, or credentials. The acting admin is `adminId` on the audit row.

## Visibility

The editor page loads the user with `applySampleUserVisibility`, the same filter as `/admin/users/[id]`. The action locks the row and then applies `profileTargetAllowed`:

- Hidden sample users (`00000000-0000-0000-0000-` auth ids, when the matching sample toggle is off) are not found.
- When preview packs are hidden, `isPreviewPackUser` (admin-preview dealer, `preview-system:` auth id, or `@preview.internal` email) is not found.
- The word "Preview" in a display name is not a classification and renaming does not change `isAdminPreview`.
- `oceanmotorvillage@itrader.im.preview` is not a `@preview.internal` address. With `isAdminPreview` false it stays editable when preview packs are hidden.

Direct action calls use the same rules as the page. Disabled users remain disabled. Deleted users are refused: "This account is deleted. Restore it before editing the profile."

The save does not send email, change payments, grant access, or activate an account.

## Refresh

Installed Next.js documents `revalidatePath(path)` for a literal path and `revalidatePath(path, "page")` when the path contains a dynamic segment (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`). There is no dealer cache tag to revalidate.

After a real change, refresh:

- `/`, `/dealers`, `/dealers/{slug}`, and `/dealers/{slug}/social-image` when the slug matches `^[a-z0-9-]+$`
- `/dealers/[slug]` and `/listings/[id]` with type `page`
- `/account`, `/account/profile`, `/dealer/dashboard`, `/dealer/profile`
- `/admin`, `/admin/users`, `/admin/users/{userId}`, `/admin/users/{userId}/profile`
- `/admin/dealers`, `/admin/listings`, `/admin/payments`, `/admin/reviews`, `/admin/cancellations`

Those are the surfaces that show `User.name` or `DealerProfile.name`: admin user, dealer, listing, payment, review, and cancellation views; the public dealer page, directory, homepage dealer cards, and social image; listing seller information. Search cards do not show seller names. The sitemap is keyed by slug, which this release does not change.

The action returns the saved editor fields and the current `updatedAt` values, without email or credentials. The form replaces its baseline with that payload so the next save sends the new timestamps.

If revalidation throws after commit, the action still returns the saved data plus: "Profile saved, but the latest pages could not be refreshed. Reload them to see the update."

## Ocean scripts

Do not change these. They compare against the canonical name `Ocean Motor Village`, not against "Ocean Motor Village Preview":

- `scripts/import-ocean-inventory/target.ts`, `apply.ts`, and `enrich-apply.ts`
- `scripts/dealer-stock-sync/registry.ts` (`ocean-motor-village`)
- `lib/preview-packs/safety.ts`

Tests must use an isolated fixture. They must not rename the live Ocean Motor Village row or any production data.

## Tests

- Schema: omitted fields, cleared fields, rejected protected keys, names, and website URLs.
- Change detection: dealer-name-only diff leaves the account untouched; omitted optional fields stay; explicit blanks clear; equal values are not changes.
- Visibility helper: preview classification is independent of the display name.
- Action: competing saves, rollback when the dealer write or audit throws, account-only editing, two consecutive saves, mismatched dealer id, disabled account stays disabled, deleted account is refused, hidden preview target is not found, refresh failure keeps the save, no-change writes no audit.
- `updateDealerProfile` is removed, not left as a second path.
- Component: discard confirmation, and a second save uses the timestamp returned by the first.
- Playwright, desktop: real form, fixture named "Ocean Motor Village Preview" renamed to "Ocean Motor Village", second edit, reload, user detail, public dealer page, listing seller, dealers row action, narrow viewport, and preserved ids, slug, subscription, and preview flag.

The action rollback test uses an in-memory transaction double. The Playwright test is the real browser and database check.

## Files

Add:

- `lib/validations/admin-profile.ts`
- `lib/admin/profile-edit.ts`
- `actions/admin/profile-edit.ts`
- `app/(admin)/admin/users/[id]/profile/page.tsx`
- `app/(admin)/admin/users/[id]/profile/profile-edit-form.tsx`
- `__tests__/validations/admin-profile.test.ts`
- `__tests__/lib/admin-profile-edit.test.ts`
- `__tests__/actions/admin-profile-edit.test.ts`
- `__tests__/components/admin-profile-edit-form.test.tsx`
- `e2e/fixtures/admin-profile-edit.ts`
- `e2e/admin-profile-edit.spec.ts`

Change:

- `actions/admin/dealers.ts` and `lib/validations/admin.ts` to remove `updateDealerProfile`
- `app/(admin)/admin/users/[id]/page.tsx` and `app/(admin)/admin/dealers/dealer-actions.tsx`
- `__tests__/validations/admin.test.ts` and `__tests__/components/dealer-actions.test.tsx`

## Out of scope

Slug editing, logo upload, avatar URL, login-email change, and any database-sync or ImageKit work.
