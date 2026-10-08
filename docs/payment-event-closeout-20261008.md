# Payment event close-out — 8 October 2026

## Production data corrections

The owner authorized investigation and resolution of test-only payment events, and explicitly confirmed that the two 7 October 20:04/20:07 BST checkouts on the second test account were unpaid tests.

- Nine verified synthetic provider events were retained as `QUARANTINED / IGNORED_TEST_EVENT`. Checks established reserved test email addresses, synthetic references/products or a one-penny subscription probe, and no user, payment, charge, claim, observation or subscription linkage. Each change has an admin audit record.
- Two confirmed abandoned test checkout attempts were changed from `REVIEW` to `EXPIRED`. Their payment rows remain `PENDING`; this does not cancel a provider transaction or prevent later verified payment reconciliation.
- One customer receipt was verified against its existing successful Featured payment, confirmed attempt, provider claim and admin reconciliation. It was retained as `QUARANTINED / RECONCILED_PAYMENT`, with an audit record linking the evidence. It was not replayed or marked processed. The customer's live Featured listing and payment were unchanged.
- Three monitoring issues were resolved with evidence: the synthetic-event group, the reconciled receipt's 20 failed attempts, and the historical missing listing-payment URL setting (validated against a fresh production environment export).

No charges, refunds, subscription access or listing entitlements were created or changed. No unresolved inbox record directly matched the first owner test account.

## Code correction

Manual admin reconciliation now atomically quarantines matching failed missing-reference receipts with `RECONCILED_PAYMENT`, rather than leaving them eligible for retries and unresolved-inbox display. A first reconciliation, an identical retry, and a later-arriving missing-reference receipt use the same checks. Late receipts are matched to the existing attestation and provider claim under transaction locks; mismatches retain the original failure and monitoring alert. The helper validates the persisted payment, confirmed attempt, provider claim, attestation, payer, canonical product/amount/currency, provider client, payload and event time. Admin-entered timestamps may match within the same second; the inbox and signed payload timestamps must match exactly. Concurrent changes fail closed. The original payload and null `processedAt` are preserved, with an audit row in the same transaction.

Focused payment reconciliation and hosted-return tests passed (53 tests), together with TypeScript, scoped lint and independent review. The registered finalise workflow provides the full release checks.

## Remaining evidence gaps

- One one-penny `Webhook Delivery Test` subscription event uses a non-reserved provider-domain address and a numeric reference. It remains quarantined pending provider confirmation.
- Recent envelope rejections only record `ccy`; they cannot be attributed to an account or reconstructed locally. Ripple delivery history is required before changing the GBP validation rule.
- The older grouped processing issue references four inbox records no longer present. The grouped stale-checkout issue also references one absent checkout; the two confirmed test contributions have been annotated and closed at the checkout level, but the whole issue has not been blanket-resolved.
- The historical onboarding subscription-conflict issue remains acknowledged; its associated invitation is revoked, not successfully completed. No entitlement repair was inferred from that history.

Private receipts and pre-change snapshots are under `private/automation/fixerrors-audit-20261007/`: `payment-test-applied.json`, `reconciled-receipt-applied.json`, `payment-issues-resolved.json`, and `payment-closeout-verification.json`. They are excluded from Git.

