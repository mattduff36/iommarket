# Product and policy decision register

Status: signed. Behaviour changes may proceed only on files that are not locked by the admin and email refactor.

Recorded: 23 September 2026, branch `preview`, HEAD `9028dde`.

## Collision ledger

The admin and email refactor in `admin-email-refactor_1a278928.plan.md` is in progress. Its dev server is running on port 4000. The following paths are locked and were not edited:

- `app/(admin)/**`
- `components/admin/**`
- `components/ui/dropdown-menu.tsx`
- `app/uidemo/page.tsx`
- `lib/email/**`
- `lib/costs/email.ts`
- `app/api/auth/send-email/route.ts`
- `lib/seo/structured-data.ts`
- `docs/itrader-admin-email-refactor-brief.md`
- `scripts/render-email-previews.ts`
- admin and email tests, including `listing-moderation-actions`, `admin-query`, `email-layout`, and transactional-email suites
- `next-env.d.ts`, because the running dev server owns its generated import path

`actions/listings.ts` is shared. Its current uncommitted change passes `listingUrl` into the buyer confirmation email and belongs to the email refactor. The contact-authorisation slice cannot edit that file until the email work is finished or the file is explicitly reassigned.

`lib/navigation.ts` contains the existing FAQ footer link. It is not part of the admin/email plan, but any later edit must preserve that line.

## Decision status

The sign-off table below is the selected outcome for all nine decisions. Each section’s evidence records the mismatch that was reviewed.

### D1. Pricing and promotions

Evidence: policies quote £4.99, £5, £29.99 and £49.99, while checkout reads `SiteSetting` through `getMarketplacePricing()`. Terms clause 5.3 already says the displayed checkout price governs a paid listing. Free-launch slots are implemented in product code. Optional listing support exists in admin pricing settings.

Options:

- Checkout price is authoritative, and policies stop quoting mutable amounts.
- Policies keep fixed amounts and are manually updated whenever settings change.
- A versioned policy release is tied to each admin pricing change.

Acceptance when signed: one source of truth across checkout, `/pricing`, policies, FAQ and tests, including promotions and any user-facing support fee.

### D2. Vehicle scope

Evidence: public categories and FAQ allow cars, vans, motorbikes and motorhomes. Terms define a vehicle more broadly, including trailers, parts and accessories. Acceptable Use and Private Seller Terms prohibit parts and number plates unless later permitted.

Options:

- Keep the four public categories and narrow the legal definition to them.
- Add trailer, parts or accessory categories and listing flows.

Acceptance when signed: seed data, validation, search, policies and FAQ describe the same sellable scope.

### D3. Geography

Evidence: Terms describe sellers or vehicles based in or located in the Isle of Man. Active regions and sell/search flows also allow United Kingdom. Search and pricing copy still sound Isle of Man-only.

Options:

- Allow UK vehicle locations and update eligibility copy.
- Enforce Isle of Man-only listing locations.
- Allow UK browsing but require an Isle of Man location to advertise.

Acceptance when signed: regions, sell form, search, metadata, pricing copy, Terms and FAQ agree.

### D4. Listing edits

Evidence: submitting a revision keeps the listing live with its last approved content. Policies say an edit may be temporarily unpublished. Administrators can still take a listing down.

Options:

- Keep the approved advert visible unless moderation unpublishes it, and say that in policy.
- Automatically unpublish an advert when an edit is submitted.

Acceptance when signed: lifecycle code, seller copy, FAQ and Private Seller/Dealer Terms describe the same default.

### D5. Moderation timing

Evidence: pricing cards say moderation within 1–2 days and dealer “priority moderation”. The sell success page says 1–2 business days. No queue priority, due date or escalation enforces either claim.

Options:

- Remove or qualify the timing and priority claims.
- Implement an operational SLA with priority, due dates, monitoring and escalation.

Acceptance when signed: public claims match either non-binding wording or an enforced operational process.

### D6. Dealer cancellation

Evidence: main Terms say dealers can cancel through account settings or by email. The dashboard request exists only when `POLICY_ENABLE_CANCELLATION_REQUESTS` is enabled, and that flag defaults off. The site cannot cancel a Ripple subscription immediately. End-of-period and no-pro-rata rules are consistent.

Options:

- Email plus an optional flag-gated dashboard request, completed by staff in Ripple.
- Always show the dashboard request, still completed by staff in Ripple.
- Build self-service cancellation in account settings and integrate it with Ripple.

Acceptance when signed: Terms, Dealer Terms, Refunds, dashboard, FAQ and provider capability make the same promise.

### D7. Buyer enquiries

Evidence: seller terms allow a guest to use the contact form. The listing page shows the form only after sign-in. `contactSeller` does not currently require an account. FAQ follows the page.

Options:

- Require sign-in in both the page and the server action, and update the terms.
- Show the existing validated form to guests and keep the public action.

Acceptance when signed: UI, server authorisation, policies and FAQ enforce one rule.

### D8. Dealer and private selling

Evidence: sign-up and account copy say private selling remains available. Dealer accounts are redirected to the dealer flow, and the listing actions reject a dealer private listing and a private-user dealer listing.

Options:

- Keep one role per account and remove the private-selling promise from dealer-facing copy.
- Allow a dealer account to create private listings as well.

Acceptance when signed: sign-up, account, route guards, listing actions and FAQ agree.

### D9. Dealer dashboard tier

Evidence: pricing and subscription cards present the dealer dashboard as a Pro feature. Access code allows any dealer with operational entitlement, including Starter.

Options:

- Offer the dashboard on Starter and Pro, and correct the marketing.
- Make dashboard access Pro-only in both marketing and authorisation.

Acceptance when signed: pricing, subscription page, navigation and entitlement checks agree.

## Sign-off

| ID | Decision | Owner | Signed outcome | Effective date |
|----|----------|-------|----------------|----------------|
| D1 | Pricing and promotions | Product owner, this session | Checkout price is authoritative. Policies stop quoting mutable pound amounts and cover the displayed price, including a current launch offer. | 23 September 2026 |
| D2 | Vehicle scope | Product owner, this session | Cars, vans, motorbikes and motorhomes only. | 23 September 2026 |
| D3 | Geography | Product owner, this session | Isle of Man-first marketplace, with UK vehicle locations allowed. | 23 September 2026 |
| D4 | Listing edits | Product owner, this session | The last approved advert stays visible unless moderation unpublishes it. | 23 September 2026 |
| D5 | Moderation timing | Product owner, this session | Remove or qualify the 1–2 day and priority claims. Do not build an SLA. | 23 September 2026 |
| D6 | Dealer cancellation | Product owner, this session | Email plus the dashboard request when it is shown. Staff complete Ripple cancellation. No immediate in-app provider cancellation. | 23 September 2026 |
| D7 | Buyer enquiries | Product owner, this session | Sign-in is required in the listing page and the server action. | 23 September 2026 |
| D8 | Dealer and private selling | Product owner, this session | Dealer and private flows stay separate. Remove copy that promises both on one dealer account. | 23 September 2026 |
| D9 | Dealer dashboard tier | Product owner, this session | Starter and Pro dealers with an active entitlement get the dashboard. | 23 September 2026 |

The admin and email refactor has finished its verification. `contactSeller` now requires an accepted signed-in account before validation, rate limiting, database access, or email. The email refactor’s `listingUrl` argument is unchanged. `AUTH-ENQ-001` covers that server check.

## Implementation record

Aligned policies, pricing and dealer marketing, search and pricing copy, moderation wording, seller-role copy, and the FAQ cancellation answer to the signed decisions. Policy versions for Terms, Dealer Terms, Private Seller Terms and the Refund Policy are `2026-09-23.1`, effective 23 September 2026.

`contactSeller` requires an accepted account before it validates, rate-limits, reads the listing, or sends email. Dealer signup no longer shows the private-seller launch offer.

The FAQ now says an advertised vehicle may be located in the Isle of Man or the United Kingdom. The admin and email refactor’s uncommitted files were left intact, apart from the sign-in check in `actions/listings.ts`, which still passes `listingUrl`.

Verification on 24 September 2026: `npm run typecheck` passed, `npm run lint` passed with existing warnings and no errors, `npm run build` passed, and `npm run test:run` passed (315 files, 1574 tests, 1 skipped). Browser checks confirmed the updated Terms, Private Seller Terms, Dealer Terms, Refunds, and FAQ cancellation answer. Pricing and dealer sign-up still redirect to the launch holding page without a gate cookie.
