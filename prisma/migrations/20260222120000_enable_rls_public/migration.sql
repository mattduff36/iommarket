-- Enable Row Level Security (RLS) on all public tables exposed to PostgREST.
-- With RLS enabled and no permissive policies, anon/authenticated roles get no access.
-- Prisma uses the connection string role (typically with BYPASSRLS), so server-side access is unchanged.
-- This resolves Supabase Security Advisor "RLS Disabled in Public" errors.

ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Favourite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."SavedSearch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AttributeDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ListingAttributeValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Region" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Listing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DealerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Report" ENABLE ROW LEVEL SECURITY;
