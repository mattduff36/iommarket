-- Keep newly added public tables private from PostgREST.
-- Prisma connects with the server-side database role; no client policies are added.

ALTER TABLE "public"."AdminAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ContentPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SiteSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."MonitoringIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."MonitoringIssueStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."MonitoringEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."MonitoringAlertDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."FreeListingClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."WaitlistUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerReviewModerationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingImageUploadIntent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingImageCleanupJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingStatusEvent" ENABLE ROW LEVEL SECURITY;
