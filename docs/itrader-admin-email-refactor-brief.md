# iTrader Admin UI/UX + Transactional Email Design System Refactor

I want you to complete two related UI/UX improvement projects in the current iTrader.im codebase:

1. Refactor the admin row-level action UI so it is compact, professional, reusable and future-proof.
2. Standardise every iTrader email template so all human-facing emails use the same professional branded design rather than a mixture of polished HTML emails and generic plain-text messages.

This is based on the current codebase.

Do not treat either task as greenfield work. Inspect the existing implementation, preserve existing business logic and security behaviour, and extend the project's existing component/design systems.

Before making changes, read:

- `AGENTS.md`
- relevant `.cursor/rules/`
- `docs/ui.md`
- the relevant Next.js documentation in `node_modules/next/dist/docs/` as required by the project instructions

Then inspect the files referenced below.

---

# PART A — ADMIN UI / UX REFACTOR

## 1. Objective

The admin interface currently exposes too many individual buttons and segmented controls inside table rows.

This is particularly visible on:

- Users
- Dealers
- Listings

Examples currently include:

- USER / DEALER / ADMIN role controls
- STARTER / PRO package controls
- Disable / Enable
- Delete / Restore
- Grant free access
- Verify / Unverify
- Downgrade
- other entity-specific operations

This causes:

- oversized Actions columns
- inconsistent row heights
- controls wrapping onto multiple lines
- poor visual hierarchy
- increasing clutter whenever a new feature is added

Do NOT solve this by simply shrinking the existing buttons.

Fix the interaction architecture so future actions can be added without redesigning the table.

---

# 2. Inspect the existing admin implementation first

Start with:

- `components/admin/admin-action-controls.tsx`
- `components/ui/dropdown-menu.tsx`
- `components/ui/dialog.tsx`
- `components/ui/table.tsx`
- `components/ui/button.tsx`
- `components/ui/badge.tsx`
- `app/(admin)/admin/users/page.tsx`
- `app/(admin)/admin/users/user-actions.tsx`
- `app/(admin)/admin/users/dealer-access-dialog.tsx`
- `app/(admin)/admin/users/[id]/page.tsx`
- `app/(admin)/admin/dealers/page.tsx`
- `app/(admin)/admin/dealers/dealer-actions.tsx`
- `components/admin/listing-moderation-actions.tsx`

Then inspect other admin tables containing row-level operations, particularly:

- Dealer onboarding
- Preview packs
- Listings
- Categories
- Vehicle Catalogue
- Regions
- Reports
- Reviews
- Waitlist
- Checklist
- Payments / Subscriptions
- Cancellations
- Revenue
- Costs
- Pages
- Media
- Audit
- Monitoring
- Settings

Before implementation, briefly report:

1. which existing components are relevant
2. which action implementations are duplicated
3. what you intend to make reusable
4. which specialist workflows should deliberately remain separate

Then continue with implementation unless you encounter a genuine product decision that cannot safely be inferred.

---

# 3. Preserve AdminActionBar

`components/admin/admin-action-controls.tsx` is already used throughout the admin interface.

Do NOT replace components such as:

- `AdminActionBar`
- `AdminActionButton`
- `AdminActionSelect`

globally.

They remain appropriate for:

- forms
- detail pages
- toolbars
- moderation interfaces
- workflows where several controls genuinely need to remain visible

Instead create a new shared abstraction specifically for compact table/list row actions.

Use an appropriate project-consistent name such as:

`AdminRowActions`

Conceptually:

`AdminActionBar` = visible toolbar or form controls

`AdminRowActions` = compact expandable actions belonging to an entity row

---

# 4. Build AdminRowActions using the existing Radix dropdown system

The project already provides:

- `DropdownMenu`
- `DropdownMenuTrigger`
- `DropdownMenuContent`
- `DropdownMenuItem`
- `DropdownMenuLabel`
- `DropdownMenuSeparator`
- `DropdownMenuSub`
- `DropdownMenuSubTrigger`
- `DropdownMenuSubContent`

in `components/ui/dropdown-menu.tsx`.

Use these.

Do not build a custom dropdown.

Do not install another UI framework.

Use the existing Lucide icon dependency when icons genuinely aid recognition.

The shared row-action system should support where appropriate:

- regular actions
- navigation actions
- async mutations
- destructive actions
- disabled actions
- conditionally hidden actions
- pending/loading states
- separators/groups
- confirmation requirements
- nested choices/submenus
- accessible labels

Keep the TypeScript API simple and strongly typed.

Do not build an excessively abstract command framework.

The desired architecture is approximately:

`AdminRowActions`
→ handles consistent presentation and interaction

`UserActions`
→ decides which user actions exist and invokes user-specific logic

`DealerActions`
→ decides which dealer actions exist and invokes dealer-specific logic

Domain-specific business logic should remain outside the generic renderer.

---

# 5. Future-proof requirement

Adding another row action later should normally mean adding another action definition.

It should NOT require:

- increasing the Actions column width
- changing the table structure
- adding another permanent button
- changing row height
- manually rebuilding menu markup on every page

Design for additional future functionality from the start.

---

# 6. Separate state from actions

This is a key UX rule.

Things such as:

- USER / DEALER / ADMIN
- Dealer Starter / Dealer Pro
- Verified / Unverified
- free grant
- paid subscription
- disabled state

represent current STATE.

They should normally be visible in their appropriate table columns using badges/text.

They should not also exist as permanent segmented controls in the Actions column.

For example:

Visible table state:

`Dealer Pro`

Menu:

`Change package >`

Visible table state:

`Verified`

Menu:

`Unverify dealer`

Visible table state:

`DEALER`

Menu:

`Change role >`

---

# 7. Row action trigger

Use a compact professional action trigger.

Depending on context this could be:

`Actions ▾`

or a compact ellipsis button.

If using an icon-only ellipsis trigger, give it an accessible entity-specific label such as:

`Actions for TD Car Centre`

Do not create a cryptic inaccessible icon button.

The trigger should:

- remain a consistent width
- have clear hover behaviour
- have visible keyboard focus
- match the current dark iTrader design
- remain unchanged regardless of the number of actions available

---

# 8. Refactor Users

Inspect:

- `app/(admin)/admin/users/page.tsx`
- `app/(admin)/admin/users/user-actions.tsx`
- `app/(admin)/admin/users/[id]/page.tsx`

`UserActions` currently serves both:

1. the Users table
2. the dedicated `/admin/users/[id]` screen

Do not blindly turn the whole component into a dropdown.

Use either:

- `variant="row" | "detail"`

or separate presentation components backed by shared action logic.

Choose whichever produces the cleaner architecture.

For table rows, use `AdminRowActions`.

For the dedicated user-management screen, visible controls/toolbars may remain preferable.

Avoid duplicating mutation logic.

---

# 9. Users table

The Users table currently compensates for its button cluster with an Actions column around:

`min-w-[320px]`

The new architecture should make that unnecessary.

A row should primarily communicate:

- user/name/email
- role
- package
- region
- dealer
- listings
- joined date
- compact Actions control

Existing user operations must remain available where relevant, including:

- manage/view account
- change role
- change package
- grant/extend complimentary dealer access
- revoke complimentary access
- disable
- enable
- delete
- restore deleted user

Only display actions relevant to that particular user.

Do not display meaningless disabled actions simply to maintain identical menu layouts.

---

# 10. Preserve user security rules

Existing server-side safeguards must remain authoritative.

In particular preserve protections preventing an administrator from:

- changing their own role where prohibited
- disabling themselves
- deleting themselves

Client-side hiding/disabling can improve UX but must never replace server-side enforcement.

---

# 11. Preserve dealer-promotion workflow

Changing a non-dealer account to DEALER currently requires the dealer access workflow and `DealerAccessDialog`.

Preserve this.

Selecting Dealer from a role-change menu must still invoke the required complimentary-access/duration workflow.

Do not bypass it.

---

# 12. Fix duplicate Disabled rendering

Inspect account-status rendering in:

`app/(admin)/admin/users/page.tsx`

The current implementation appears capable of showing `Disabled` twice because account state is rendered in more than one conditional.

Correct this.

The desired behaviour is:

- Deleted displayed once
- Disabled displayed once
- clear intentional precedence between Deleted and Disabled

Add a regression test where appropriate.

---

# 13. Investigate dealer navigation

The Users table currently links dealer information to something equivalent to:

`/admin/dealers?id=<dealerId>`

However the current Dealers page appears to use search parameters such as:

- `q`
- `verified`
- `page`

and does not obviously consume `id`.

Verify the workflow.

If that dealer link currently has no useful effect, correct it.

Do not create a large dealer-management feature solely to justify the existing link.

Use the smallest coherent fix.

Explain the result in the final report.

---

# 14. Refactor Dealers

Inspect:

- `app/(admin)/admin/dealers/page.tsx`
- `app/(admin)/admin/dealers/dealer-actions.tsx`

The Dealers table already exposes useful status/data fields including:

- Verified
- Package
- Subscription
- Listings
- Joined

Keep these immediately visible.

Move operations into the shared compact action system.

Existing operations must remain available, including:

- Verify / Unverify
- Change package
- Grant complimentary access
- Downgrade dealer to user
- other existing dealer operations discovered during inspection

The current Actions column around `min-w-[220px]` should no longer be necessary.

---

# 15. Paid dealer package restriction

The existing backend restricts manual package changes where a paid subscription is active.

Preserve this rule.

If changing package is unavailable, communicate that clearly in the UI rather than making it appear broken.

Do not alter entitlement logic as part of this UI refactor.

---

# 16. Role/package choices

Permanent segmented controls should disappear from table rows.

Use an interaction similar to:

`Change role >`

- User
- Dealer
- Admin

and:

`Change package >`

- Dealer Starter
- Dealer Pro

Clearly indicate the current selection.

If the current dropdown wrapper does not expose appropriate Radix radio-menu primitives, extend the wrapper using the existing Radix dependency.

Do not build custom keyboard-selection behaviour.

---

# 17. Destructive actions

Destructive actions should be visually separated from routine actions and normally placed at the bottom of the menu.

Examples:

- Delete
- Disable
- Downgrade where consequential
- destructive subscription/account actions

Use the existing danger styling.

Replace browser `confirm()` usage encountered in these refactored flows.

The project already has:

`components/ui/dialog.tsx`

Create a small reusable admin confirmation abstraction if appropriate, such as:

`AdminConfirmDialog`

It should support:

- title
- description
- entity name/context
- confirm label
- destructive styling
- pending state
- cancellation

Preserve stronger confirmation workflows where they already exist.

---

# 18. Delete semantics

For user soft deletion, the confirmation should accurately explain the current behaviour.

Do not imply permanent destruction if it is reversible.

Communicate existing behaviour such as:

- account becomes deleted/disabled according to current lifecycle rules
- listings remain archived where applicable
- restoration is supported where applicable

Do not change backend deletion semantics.

---

# 19. Loading/error UX

Existing admin actions use mechanisms including:

- `useTransition`
- server actions
- `router.refresh()`

Preserve these patterns unless there is a strong reason to improve them.

When one action runs:

- prevent duplicate submission
- identify the pending operation
- don't disable unrelated rows
- retain useful error feedback
- refresh/revalidate appropriate data after success

Be careful with async actions launched from a menu that immediately closes.

Errors must still be visible to the administrator.

Do not create a new global notification system solely for this task.

---

# 20. Table density

The refactor should materially reduce table width and row height.

Do not globally crush table padding to compensate for bad Actions cells.

A dealer with five possible operations should occupy approximately the same row height as a dealer with two operations.

Actions should consume a predictable small amount of horizontal space.

---

# 21. Listings

Inspect:

`components/admin/listing-moderation-actions.tsx`

It currently supports:

- inline
- floating

Do NOT convert the specialist floating moderation toolbar into an Actions dropdown.

It serves a different workflow.

Evaluate only the inline/table variant for migration to `AdminRowActions`.

The Listings table currently has an Actions column around `min-w-[260px]`.

Improve that if the shared action system is appropriate.

Preserve the specialist floating review experience.

---

# 22. Remaining admin tables

After Users and Dealers are complete, inspect other table action implementations.

Use the common row-action component where it naturally improves consistency.

Likely candidates include:

Regions:
- Enable / Disable
- Delete

Categories:
- Activate / Deactivate
- Delete

Waitlist:
- Copy email
- Delete / Restore

Payments / subscriptions:
- evaluate carefully because of financial impact

Pages:
- a single Edit action probably does not need to be hidden in a menu

Cancellations:
- currently includes richer workflow controls such as notes
- do not simply stuff a complex form into a dropdown

The principle is:

Use the common row-action system where it improves the workflow.

Do not force every admin interaction into a dropdown purely for consistency.

---

# 23. Accessibility

Verify:

- keyboard opening
- arrow-key navigation
- Enter/Space activation
- Escape close
- submenu navigation
- visible focus
- sensible focus return
- correct disabled state
- meaningful trigger labels

Use Radix's built-in accessibility instead of reimplementing it.

---

# 24. Overflow

`components/ui/table.tsx` uses an overflow container.

The existing Radix DropdownMenu uses a Portal, which should help avoid clipping.

Still manually test:

- first row
- last visible row
- right-most column
- horizontally scrolled table
- narrow viewport

Menus must remain inside the usable viewport.

---

# 25. Admin visual design

Preserve the current iTrader visual language:

- dark admin surfaces
- existing typography
- blue accent/focus styling
- green success treatment
- red destructive treatment
- existing borders
- existing spacing/radius system

Do not introduce another admin theme.

---

# PART B — STANDARDISE ALL EMAIL TEMPLATES

## 26. Objective

The application currently sends emails with inconsistent visual quality.

Some newer emails are branded HTML.

Other important emails are plain-text-only and look like generic system messages.

The password-reset email is one example.

The target visual style is the newer dealer onboarding/activation email:

- black outer email background
- centred dark navy iTrader card
- subtle blue border
- iTrader logo prominently displayed
- white heading
- clean light body copy
- strong blue CTA button
- good spacing
- professional hierarchy
- concise security/expiry information
- consistent iTrader branding

All human-facing emails should feel like they came from the same product.

---

# 27. Audit every outgoing email first

Search the entire repository for every email-send path.

Do not limit the audit to `lib/email/`.

Search for at least:

- `resend.emails.send`
- `sendResendEmail`
- email helper functions
- Supabase Auth Send Email hook handling
- notification systems
- admin notification emails
- waitlist emails
- listing lifecycle emails
- dealer emails
- cancellation emails
- cost/invoice emails
- report emails
- monitoring emails
- seller/buyer contact emails
- dealer onboarding/invitation emails

Produce an inventory before implementation.

For every email identify:

- function/file
- audience
- purpose
- current subject
- whether it currently has HTML
- whether it currently uses a shared renderer
- primary CTA, if any
- expiry/security messaging, if any

Then refactor the system.

---

# 28. Current known inconsistencies

In the current codebase, inspect these specifically:

`lib/email/resend.ts`

Several messages are currently text-only, including:

- seller contact/enquiry
- buyer enquiry confirmation
- signup confirmation
- password reset
- magic-link sign-in
- email change confirmation
- generic invite
- listing report confirmation
- admin listing report notification
- monitoring alerts

These should no longer be visually generic where they are human-facing emails.

Also inspect:

- `sendWaitlistConfirmationEmail`
- `sendWaitlistAdminNotificationEmail`

These currently contain bespoke HTML rather than using the common email renderer.

Other areas already use:

`lib/email/layout.ts`

and `renderBrandedEmail()`, including examples such as:

- listing lifecycle notifications
- dealer verification
- dealer-review notifications
- cancellation notifications
- cost/invoice notifications

However the existing renderer is quite limited and generally renders text lines rather than richer structured sections and CTA buttons.

Refactor this into one coherent system.

---

# 29. Dealer onboarding email as design reference

Use the current/new dealer onboarding activation email as the visual reference.

The desired result should resemble the existing email headed:

`Claim your dealer account`

with its strong branded card and blue:

`Review and accept`

CTA.

If the exact dealer-onboarding implementation exists elsewhere in the current working tree, locate it and use/refactor it into the shared system.

If that implementation is not present in this exported snapshot, reproduce its visual language using the existing iTrader assets and the supplied design direction.

Do not create a visually competing second email style.

---

# 30. Build one reusable branded transactional email renderer

Refactor or evolve:

`lib/email/layout.ts`

into the shared foundation for all transactional emails.

Do not create dozens of near-identical HTML strings.

The shared renderer should support appropriate structured content such as:

- preheader text if useful
- title
- intro
- paragraphs
- optional key/value details
- optional highlighted information box
- optional primary CTA
- optional secondary link
- optional warning/security notice
- optional expiry information
- footer
- plain-text fallback generation

The exact TypeScript API is your decision.

Keep it simple, type-safe and easy to extend.

Do not turn it into an elaborate generic page-builder.

---

# 31. Email design specification

Aim for a robust shared design close to:

Outer background:

- black / near-black

Email card:

- maximum width approximately 620–640px
- width 100% on narrow clients
- dark navy background consistent with current branding
- subtle navy/blue border
- approximately 12–14px radius where supported
- generous but not excessive padding

Logo:

- use the existing iTrader email/site logo asset
- absolute public URL based on the canonical application URL
- approximately 220–230px maximum width
- centred

Heading:

- white
- prominent
- approximately 24–28px on desktop
- strong weight

Body:

- approximately 15–16px
- comfortable line height
- light neutral/blue text
- easy to read
- concise paragraphs rather than walls of text

Primary CTA:

- iTrader blue
- white text
- obvious clickable button
- generous click/tap target
- rounded corners
- descriptive label

Footer:

- subtle separator where appropriate
- `iTrader.im`
- optional `Buy • Sell • Upgrade`
- support/contact wording only where useful

Do not unnecessarily copy every pixel from one screenshot.

Create a consistent design system based on it.

---

# 32. Email-client compatibility

Transactional email HTML must work reliably across common email clients.

Use:

- table-based structural layout where appropriate
- inline CSS
- standard system-safe fonts
- absolute image URLs
- standard `<a href>` CTA links

Do NOT rely on:

- application Tailwind classes
- CSS variables
- client-side JavaScript
- React hydration
- browser-only layout techniques
- externally loaded CSS
- fragile effects required for readability

The message should still look professional if some advanced styling is ignored.

Prioritise:

- Gmail
- Apple Mail
- Outlook
- common mobile email clients

Do not introduce unnecessary email-framework dependencies unless there is a strong technical reason.

---

# 33. Plain-text fallback remains mandatory

Every HTML email must also have a useful plain-text equivalent.

Do not remove `text`.

The plain-text version should contain:

- the same important information
- relevant URLs
- expiry information
- security instructions
- contact information where applicable

HTML is the polished presentation.

Plain text remains the fallback.

---

# 34. Auth emails are a priority

Refactor all Supabase Auth hook emails sent from:

`app/api/auth/send-email/route.ts`

and the associated functions in:

`lib/email/resend.ts`

At minimum standardise:

### Signup confirmation

Subject may remain similar to:

`Confirm your iTrader account`

Branded HTML should contain:

- welcome/confirmation heading
- concise explanation
- CTA such as `Confirm email`
- expiry information
- "If you did not create this account..." notice

### Password reset

This must no longer resemble the generic text-only email.

Use a branded message such as:

Heading:

`Reset your password`

Body:

Explain that a password reset was requested.

Primary CTA:

`Reset password`

Security copy:

- link expires in 1 hour
- if they did not request the change, they can ignore the message
- do not expose unnecessary technical information

The full URL should remain available in the plain-text fallback.

If useful, include a subdued fallback link in HTML for clients where the CTA fails, but do not make the giant raw token URL the dominant visual element.

### Magic link

Use:

- clear sign-in heading
- `Sign in to iTrader` CTA
- one-time/expiry explanation
- ignore-if-unexpected notice

### Email change

This flow can involve confirmation from two addresses.

Make the steps visually understandable.

Do not compromise the existing security model.

Use clearly differentiated CTA/steps as appropriate.

### Invite email

Use a branded invitation message with a clear:

`Accept invitation`

CTA.

Preserve existing link expiry semantics.

---

# 35. Never weaken auth security

The email redesign must not alter the security properties in:

`app/api/auth/send-email/route.ts`

Preserve:

- webhook signature verification
- canonical origin handling
- safe `next` path validation
- token hash flow
- same-origin redirects
- existing expiry behaviour
- Supabase email action types

Never log or expose authentication tokens to monitoring systems unnecessarily.

Do not change authentication logic simply because the email HTML is changing.

---

# 36. CTA links must be safe

Dynamic content must continue to be escaped correctly.

Make sure:

- visible dynamic text is HTML escaped
- dynamic attribute values are safely escaped
- CTA URLs are appropriate absolute URLs
- user-generated text cannot break email HTML
- seller enquiry text cannot inject HTML

Do not use unsanitised string interpolation for user-controlled HTML.

Reuse or improve `escapeHtml()` appropriately.

---

# 37. Seller enquiry email

The seller-contact email should be branded but remain functionally useful.

It should clearly show:

- listing name
- enquiry sender name/email
- buyer's message
- a CTA such as `View listing`
- that replying to the email replies to the buyer, where relevant

Preserve the existing `replyTo` behaviour.

User-submitted enquiry text must be safely escaped and presented legibly.

Do not make the design obscure the actual enquiry.

---

# 38. Buyer enquiry confirmation

The confirmation sent to the buyer should use the same branding.

Communicate clearly:

- the enquiry was sent
- which listing it concerned
- the seller should reply directly

Add an appropriate listing CTA only if the URL is available in the existing workflow without unnecessarily changing unrelated APIs.

Do not over-engineer this small confirmation.

---

# 39. Listing lifecycle emails

Existing listing notification emails already use `renderBrandedEmail()`.

Improve them to take advantage of the new structured template.

Where appropriate turn raw URL body lines such as:

`Open listing: https://...`

into a proper CTA such as:

`View listing`

or:

`Manage my listings`

Preserve important moderation information such as:

- listing title
- moderation status
- reason
- correction guidance
- resubmission guidance
- appeal information
- refund advisory

Do not hide important moderation reasons behind styling.

Do not expose internal/admin-only notes.

Preserve the existing tests protecting that behaviour.

---

# 40. Dealer emails

Standardise all dealer-related emails, including:

- verification granted
- verification removed
- review-response moderation
- disputes
- dealer onboarding/invitation
- complimentary access communications
- other dealer notifications discovered during the audit

Use useful CTAs where appropriate, for example:

- `Open dealer dashboard`
- `Manage reviews`
- `Review and accept`

Maintain accurate state-specific copy.

---

# 41. Cancellation emails

Existing cancellation emails already use the shared renderer.

Move them onto the improved layout without changing cancellation semantics.

Preserve the distinction between:

- requested
- acknowledged
- reconciled
- completed
- unsuccessful/problem state

Do not make an acknowledgement look like a completed provider cancellation if it is not one.

Make period-end information easy to scan.

Where useful provide a CTA to the appropriate dealer/account area.

---

# 42. Waitlist emails

Refactor both the customer waitlist confirmation and administrator waitlist notification away from one-off HTML implementations.

They should use the same reusable email system while retaining their specific content.

Preserve useful elements from the current styled waitlist email, including its strong visual identity.

Do not allow waitlist emails to drift into a separate design language.

---

# 43. Reports and admin notifications

Standardise:

- report-received confirmation
- admin report notification
- moderation notifications
- waitlist admin notification
- similar human-readable operational emails

Internal/admin emails can be somewhat denser than customer emails, but they should still look recognisably like iTrader.

For internal emails, consider structured detail rows for information such as:

- reporter
- listing
- reference ID
- reason
- timestamp
- source

Do not prioritise decorative presentation over operational clarity.

---

# 44. Monitoring alerts

Inspect `sendMonitoringAlertEmail`.

Determine how it is used.

If these messages are normal human-readable monitoring notifications, give them the shared iTrader shell while preserving the original alert text.

If there is a technical reason for a specific monitoring consumer to require plain-text-only messages, document the exception rather than blindly converting it.

Do not break alert delivery.

---

# 45. Cost/invoice emails

Existing cost/invoice emails use the branded renderer.

Migrate them to the improved system.

Important financial details such as:

- amount
- request/reference
- confirmation action

must remain clear.

If there is an actionable confirmation URL, render it as a proper CTA.

Do not alter the cost calculation or transactional-outbox behaviour.

---

# 46. Email copy hierarchy

Each transactional email should normally answer these questions quickly:

1. What happened?
2. What does the recipient need to do?
3. When do they need to do it?
4. What happens next?
5. What should they do if they did not initiate the action?

Avoid generic raw system wording.

Keep copy concise and professional.

Do not add marketing fluff to security or operational emails.

---

# 47. Consistent CTA wording

Use clear action-based labels.

Examples:

- Confirm email
- Reset password
- Sign in to iTrader
- Accept invitation
- Review and accept
- View listing
- Manage listing
- Open dealer dashboard
- Manage reviews
- Confirm invoice request

Avoid vague buttons such as:

- Click here
- Continue
- Submit

unless context makes them clearly preferable.

---

# 48. Expiry/security notices

Where a link expires, display this consistently.

For example:

`This link expires in 1 hour.`

or a clearly formatted security/expiry note.

Preserve actual existing expiry durations.

Do not invent new expiry times from the email template.

The source of truth remains the current authentication/invitation logic.

---

# 49. Subject lines

Review subject consistency while doing the email audit.

Subjects should be:

- concise
- descriptive
- recognisably iTrader
- free of unnecessary technical wording

Do not rewrite working subjects purely for style.

Keep useful dynamic information where it helps, such as dealer invitation expiry information if that is an intentional part of the current onboarding workflow.

---

# 50. Email footer

Create one consistent footer through the shared renderer.

Use an appropriate version of:

`iTrader.im`

`Buy • Sell • Upgrade`

Where useful include:

`hello@itrader.im`

Do not add unsubscribe language to essential transactional emails unless legally or functionally required.

Do not imply users can opt out of security emails that are necessary to operate their account.

---

# 51. Canonical asset URLs

Use the canonical public application origin for email assets.

The current public logo is available at:

`/images/logo-itrader-hq.png`

Ensure email HTML uses an absolute URL, for example via the configured application origin.

Do not embed local filesystem paths.

Do not depend on Vercel preview hosts where production canonical URL handling already exists.

Where practical reuse an existing canonical URL helper rather than duplicating URL-origin logic.

---

# 52. Avoid duplicated email HTML

After the refactor there should NOT be separate large blocks of hand-written email-shell HTML in:

- waitlist emails
- auth emails
- dealer emails
- listing emails
- admin emails

unless there is a genuinely exceptional requirement.

Centralise:

- outer background
- email card
- logo
- typography
- CTA rendering
- details blocks
- notice blocks
- footer

Individual email functions should primarily define:

- subject
- title
- body copy
- details
- CTA
- security/expiry note

---

# 53. Do not create a giant resend.ts

`lib/email/resend.ts` already contains unrelated categories of email.

While doing this work, evaluate whether splitting the implementation into purpose-specific modules would improve maintainability.

For example, the final structure could conceptually separate:

- auth emails
- marketplace/contact emails
- waitlist emails
- report/admin emails
- shared rendering/client helpers

Do not reorganise files purely for aesthetics.

If splitting clearly improves maintainability and reduces the current mixed responsibilities, do it carefully and update imports/tests.

Keep email delivery plumbing separate from email copy/template construction where practical.

---

# 54. Make individual emails testable

Where practical, separate template construction from delivery.

A useful pattern already exists in functions such as:

`buildListingStatusEmail()`

and:

`buildDealerVerificationEmail()`

Extend that idea.

For important templates, allow tests to build the output without sending an actual email.

This makes it possible to verify:

- subject
- text
- HTML
- CTA
- escaping
- expiry copy

without invoking Resend.

---

# 55. Email tests

Add/update tests for the shared renderer and representative emails.

At minimum test:

- shared branded wrapper exists
- logo appears
- heading is escaped
- body content is escaped
- CTA URL and label render correctly
- plain-text equivalent contains the CTA URL
- optional sections do not render when absent
- password reset contains the Reset password CTA
- signup contains Confirm email
- magic link contains Sign in to iTrader
- invitation email contains appropriate CTA
- waitlist email uses shared branding
- listing lifecycle emails preserve moderation copy
- seller enquiry content is escaped
- HTML cannot be injected through listing names, dealer names, reasons or buyer messages
- financial/cost amount behaviour remains unchanged

Do not write brittle tests asserting every inline CSS character.

Test structure, semantics and important content.

---

# 56. Do not expose auth secrets in tests/snapshots

If email HTML is snapshot-tested, use fake token URLs.

Never commit genuine tokens, credentials or private email content.

Do not log authentication links during normal application operation.

---

# 57. Email manual QA

Produce sample output for the main email categories and inspect them visually.

At minimum check:

- dealer onboarding/invite
- signup confirmation
- password reset
- magic link
- email change
- seller enquiry
- buyer enquiry confirmation
- listing approved
- listing rejected
- dealer verification
- cancellation update
- waitlist confirmation
- admin/report notification
- cost/invoice confirmation

Check at desktop and narrow/mobile widths.

Check the generated HTML for common-client compatibility.

Do not send production emails to real users for QA.

Use existing safe test/dev mechanisms.

---

# 58. Optional email preview tooling

Check whether the project already has a safe email preview mechanism.

If one exists, use and improve it.

If none exists, only add lightweight local/development preview tooling if it materially helps maintain these templates and can be kept completely inaccessible in production.

Do not add a publicly reachable production email-preview route.

This is optional and should not delay the core work.

---

# PART C — SHARED ENGINEERING REQUIREMENTS

## 59. Preserve backend/business logic

This work is primarily presentation and component architecture.

Do not change:

- authentication security
- authorization
- entitlement calculations
- subscription rules
- dealer lifecycle rules
- moderation decisions
- audit logging
- cancellation semantics
- cost calculations
- transactional outbox semantics
- database schema

unless an existing defect requires a small, clearly justified fix.

No Prisma migration should be necessary.

---

# 60. Keep scope controlled

Fix directly related inconsistencies you encounter, including:

- duplicate Users Disabled badge
- ineffective `/admin/dealers?id=...` navigation if confirmed
- duplicated email shells
- generic text-only user-facing emails

Do not use this task to redesign unrelated public pages or rewrite unrelated backend services.

---

# 61. `/uidemo`

`docs/ui.md` indicates reusable UI components should be represented in `/uidemo`.

If appropriate, add examples of new reusable admin components such as:

- `AdminRowActions`
- `AdminConfirmDialog`

to:

`app/uidemo/page.tsx`

Email templates do not need to be rendered publicly in `/uidemo`.

Do not expose auth-token email previews there.

---

# 62. Automated verification

Follow the project rules and existing npm scripts.

Run focused tests throughout implementation.

Before completion run the project's required final verification, including:

- `npm run typecheck`
- `npm run test:run`
- `npm run lint`
- `npm run build`

Also use the project's registered finalise workflow/rules as required by the repository instructions.

Do not run Prisma migrations or `db:push`.

Fix problems caused by this implementation rather than suppressing errors.

---

# 63. Admin acceptance criteria

The admin work is complete only when:

1. Users no longer contains a 320px-wide cluster of permanent controls.
2. Dealers no longer contains multi-row action-button clusters.
3. Row height does not materially depend on the number of available actions.
4. Current state remains immediately visible.
5. Secondary operations use one professional shared action system.
6. Destructive actions are separated and properly confirmed.
7. Existing user/dealer business rules remain intact.
8. Dedicated user-management pages still use an appropriate detail-page UI.
9. New actions can normally be added without altering table geometry.
10. Dropdowns work with keyboard input.
11. Dropdowns are not clipped by table overflow.
12. Duplicate Disabled rendering is fixed.
13. `/admin/dealers?id=...` behaviour has been investigated and corrected if ineffective.
14. Suitable other admin tables reuse the component.
15. Specialist workflows are not forced into inappropriate dropdowns.

---

# 64. Email acceptance criteria

The email work is complete only when:

1. Password-reset emails use the branded HTML design.
2. Signup emails use the branded HTML design.
3. Magic-link emails use the branded HTML design.
4. Email-change messages use the branded HTML design.
5. Invite emails use the branded HTML design.
6. Dealer onboarding uses the same shared visual system.
7. Seller/buyer marketplace emails use the shared visual system.
8. Listing lifecycle emails use the improved shared system.
9. Dealer/review notifications use the shared system.
10. Cancellation emails use the shared system.
11. Waitlist emails no longer maintain a completely separate email shell.
12. Cost/invoice emails use the shared system.
13. Human-readable admin/report emails are visually consistent.
14. Every HTML email has a complete plain-text fallback.
15. CTA links appear as proper buttons where appropriate.
16. Auth link security and redirect logic are unchanged.
17. User-controlled content is properly escaped.
18. Email HTML does not rely on Tailwind, JavaScript or browser-only CSS.
19. Major email types have regression tests.
20. Future transactional emails can use the shared renderer without copying a full HTML document.

---

# 65. Final report

When complete, give me a structured report covering the following.

## Admin architecture

Explain:

- `AdminRowActions`
- confirmation architecture
- how `UserActions` works
- how `DealerActions` works
- how a developer adds another action later

Show a small example of adding a hypothetical future action such as:

`Send password reset`

without altering table layout.

## Admin pages updated

List every admin page migrated to the shared row-action system.

Also list pages deliberately left unchanged and explain why.

## Admin issues investigated

Specifically report the result of investigating:

- duplicate Disabled status
- `/admin/dealers?id=...`

## Email architecture

Explain the shared email renderer and its supported primitives, such as:

- heading
- body
- details
- CTA
- notice
- footer
- text fallback

Explain how a developer should add a new transactional email in future.

## Email inventory

List every outgoing email discovered during the audit.

For each one report:

- file/function
- audience
- whether it was previously plain text, bespoke HTML or shared HTML
- what it uses after the refactor

## Email examples

Specifically explain the final appearance/behaviour of:

- password reset
- signup confirmation
- magic link
- email change
- dealer invite/onboarding
- seller enquiry
- listing moderation
- cancellation
- waitlist

## Files changed

List each relevant file and what changed.

## Tests

Report new or updated tests.

## Verification

Report the actual results of:

- typecheck
- tests
- lint
- build

Do not simply say "everything passes".

Give the commands and results, including any warnings.

## Remaining opportunities

Identify any worthwhile follow-up UI/email improvements without implementing unrelated changes during this task.

---

The goal is not merely to make the current screens and emails look nicer.

The goal is to leave iTrader with two maintainable systems:

1. A scalable admin action architecture where additional features do not make tables progressively more cluttered.
2. A scalable transactional-email design system where new emails automatically look like iTrader rather than generic system messages.
