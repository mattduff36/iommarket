# Launch verification and release order

This checklist covers the launch changes shared by preview and production. It is
not approval to deploy, apply migrations, send test emails or take real payments.

## Before deployment

- Complete the combined typecheck, test suite, lint and production build after
  concurrent editors finish. Component tests alone do not verify provider delivery.
- Back up each target database and review the additive dealer-address and payment
  migrations. Do not use schema push or reset.
- Follow `legacy-featured-reconciliation.md` before enabling the new approval-time
  Featured consumer. Historical purchases must not be blindly granted again or
  marked consumed without checking their history.
- Configure the combined Ripple link with `RIPPLE_LISTING_AND_FEATURED_PAYMENT_URL`
  in the appropriate Vercel scopes. Confirm its configured amount matches the
  listing fee plus Featured fee (£9.99 at launch).
- Keep the checklist disabled in production and enabled in preview. Confirm the
  server-side flag protects reads, writes, navigation and direct URL access.
- Preserve preview simulator production/database guards and the existing real
  weekly subscription and signed renewal forwarding configuration.

## Preview acceptance

Use isolated accounts and listings, never the real weekly-renewal account for
destructive tests. Confirm both the acting user's view and an independent session.

- Paid private listing: Featured off and on, exact total, new checkout tab,
  successful and declined sample cards, retry, duplicate callback, moderation.
- Free private listing and entitled dealer: no base charge; optional Featured
  charges only its own fee. A failed upgrade leaves the standard listing submitted.
- Pending Featured purchase: no public promotion before approval; approval applies
  the benefit once. Replayed success after refund must not restore entitlement.
- Listing owner sees the upsell; another buyer/admin browsing someone else's
  listing does not. Dismissal explains where to upgrade later.
- Admin editing: fresh modal data, confirmation, audit, stale edit rejection,
  seller-revision conflict and error recovery without losing entered values.
- Free dealer grant/revoke: owner message, notification outcome, public stock
  visibility, paid subscription coexistence and five-second cross-session update.
- Account actions: confirmations, pending state, recovery and correct final status.
- Dealer public address: first custom address, two changes per rolling year,
  old-address redirect, collision prevention and old-address reservation.
- Signup: unchecked consent, field-specific failures, successful verification email
  with iTrader sender/branding and a working verification link.
- Production checklist direct URL redirects home and all checklist writes fail
  while disabled. Preview retains its merged entries.

## Production acceptance

Promote only the verified shared code after release approval. Recheck production
environment flags and migrations; simulator checkout must remain unavailable.
Any live payment or outgoing notification test needs its own authorized account
and scope. Observe the existing £1 subscription renewal separately; simulated
success does not prove recurring provider delivery.
