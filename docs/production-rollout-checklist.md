# Production rollout checklist

This is the manual release procedure for the listing-revision and Ripple
contract changes. Local verification does not authorize production changes.

## 1. Provider and environment prerequisites

- Ripple underwriting is approved.
- Ripple confirms that the initial payment echoes `reference` as
  `merchant_reference`.
- Ripple confirms the exact `X-Ripple-Signature` lowercase-hex HMAC contract
  and `{ event, client_id, timestamp, data }` envelope.
- Vercel Production has `RIPPLE_CLIENT_ID`, `RIPPLE_WEBHOOK_SECRET`,
  `RIPPLE_REFERENCE_SECRET`, `CRON_SECRET`, and the four canonical `/pay/{code}`
  URLs.
- Keep `RIPPLE_LIVE_CHECKOUT_ENABLED=0`.

## 2. Database checkpoint

Back up production and record migration status before applying anything:

```bash
npx prisma migrate status
```

Record listing counts by status before any pending lifecycle backfill:

```sql
SELECT status, COUNT(*) FROM "Listing" GROUP BY status ORDER BY status;
```

If `PaymentWebhookInbox` already exists, also record its counts by status.

If `20260815002000_lifecycle_backfill` is still pending, retain a listing ID and
status export. Its rollback mapping for old code is `REJECTED -> TAKEN_DOWN`;
do not reverse `APPROVED` mappings without reviewing their generated
`SYSTEM_BACKFILL` events.

Apply migrations before deploying matching application code:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Verify that the revision partial index, payment-reference uniqueness, inbox
body-hash uniqueness, and RLS are present:

```sql
SELECT indexname
FROM pg_indexes
WHERE indexname IN (
  'ListingRevision_open_listingId_key',
  'SubscriptionCharge_paymentReference_key',
  'PaymentWebhookInbox_bodyHash_key'
);

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'SubscriptionCharge',
  'PaymentWebhookInbox',
  'ListingRevision',
  'ListingRevisionImage',
  'ListingRevisionAttributeValue'
);
```

All five `relrowsecurity` values must be `true`.

## 3. Disabled-first deployment

Deploy with checkout disabled. Confirm:

- the site and admin listing queue load;
- the Ripple retry cron is authorized by `CRON_SECRET`;
- unsigned, prefixed, uppercase, base64, and invalid signatures return `400`;
- one correctly signed non-monetary provider probe returns `200`;
- failed, quarantined, ambiguous, stale-PENDING, stale-PROCESSING, and
  max-attempt inbox rows are visible to operations.

Do not replay a synthetic payment event against a real listing or dealer.

## 4. Acceptance payments

With a disposable test account, perform one small real purchase through each
canonical link:

1. Private listing fee.
2. Featured upgrade.
3. Dealer Starter subscription.
4. Dealer Pro subscription.

For every payment, verify the inbox row, local payment or charge, listing
transition or dealer entitlement, email behavior, and Ripple portal record.
Refund each payment manually through Ripple.

Only set `RIPPLE_LIVE_CHECKOUT_ENABLED=1` after all four flows pass.

## 5. Seller withdrawal browser checks

Use disposable private-seller and dealer accounts against a non-production
database:

- Submit a listing and confirm its account row says **Awaiting review**, has no
  edit action, and offers **Withdraw submission**.
- Cancel the withdrawal confirmation and verify the listing remains pending.
- Confirm withdrawal and verify the control becomes disabled with
  **Withdrawing…**, then opens the Draft editor with details, attributes,
  trust declaration, photo order, and focal points intact.
- For a paid and a free-claim listing, edit and resubmit the withdrawn draft.
  Verify no second checkout opens and no second `FreeListingClaim` is created.
- Verify a paid Featured submission remains Featured after withdrawal and is
  still non-public until approval.
- Verify self-withdrawal creates one `WITHDRAW` status event but sends neither
  the moderation-inbox submission email nor an admin-style seller status email.
- In two sessions, race admin approval against seller withdrawal. Exactly one
  action must succeed; the loser must show refresh guidance without creating an
  extra status event or monitoring issue.
- Replay an older disposable payment event after withdrawal. Verify payment is
  `SUCCEEDED`, the listing remains `DRAFT`, no submission email is sent, and the
  safe business event is recorded.

Do not run these checks against production listings or the production payment
webhook.

## 6. Rollback and operations

- First response to payment trouble: set `RIPPLE_LIVE_CHECKOUT_ENABLED=0`.
- Keep webhook ingestion and retry enabled for payments already made.
- Roll application code back only to a schema-compatible release.
- Refunds and cancellations remain portal-managed.
- Reconcile Ripple portal records against local inbox/payment/charge rows
  daily because Ripple does not retry deliveries.
- Define and apply an operational retention period for minimized processed
  inbox data; never store raw bodies, signatures, reference tokens, or secrets.
