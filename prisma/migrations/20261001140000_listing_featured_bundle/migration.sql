-- Record the Featured component of a combined listing purchase and make the
-- one-shot Featured entitlement safe to apply after moderation approval.
ALTER TABLE "Payment"
  ADD COLUMN "includesFeatured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "featuredAppliedAt" TIMESTAMP(3);

-- Historical FEATURED payments need an environment-specific reconciliation:
-- some were applied and later cleared by listing lifecycle actions, while
-- others may never have been applied. Run the reviewed reconciliation before
-- deploying approval-time entitlement consumption.

ALTER TABLE "SampleCheckout"
  DROP CONSTRAINT IF EXISTS "SampleCheckout_kind_check";
ALTER TABLE "SampleCheckout"
  ADD CONSTRAINT "SampleCheckout_kind_check"
  CHECK ("kind" IN ('listing_payment', 'listing_and_featured', 'featured_upgrade', 'dealer_subscription'));
