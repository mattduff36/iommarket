-- Keep newly added payment and listing-revision tables private from PostgREST.
-- Prisma connects with the server-side database role; no client policies are added.

ALTER TABLE "public"."SubscriptionCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PaymentWebhookInbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingRevisionImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingRevisionAttributeValue" ENABLE ROW LEVEL SECURITY;
