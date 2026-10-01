-- Reserve every former dealer profile address and redirect it to the latest
-- profile address. This is additive; existing current slugs remain protected
-- by DealerProfile.slug's unique index.

CREATE TABLE "DealerProfileSlugHistory" (
  "id" TEXT NOT NULL,
  "dealerId" TEXT,
  "slug" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "countsTowardsLimit" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "DealerProfileSlugHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DealerProfileSlugHistory_slug_key"
ON "DealerProfileSlugHistory"("slug");

CREATE INDEX "DealerProfileSlugHistory_dealerId_countsTowardsLimit_changedAt_idx"
ON "DealerProfileSlugHistory"("dealerId", "countsTowardsLimit", "changedAt");

ALTER TABLE "DealerProfileSlugHistory"
ADD CONSTRAINT "DealerProfileSlugHistory_dealerId_fkey"
FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "public"."DealerProfileSlugHistory" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.guard_dealer_profile_slug_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  slug_key TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."slug", 0));
    IF EXISTS (
      SELECT 1 FROM public."DealerProfileSlugHistory" h
      WHERE h."slug" = NEW."slug"
    ) THEN
      RAISE EXCEPTION 'Dealer profile address is permanently reserved'
        USING ERRCODE = '23505', CONSTRAINT = 'DealerProfileSlugHistory_slug_key';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."slug" IS NOT DISTINCT FROM NEW."slug" THEN
    RETURN NEW;
  END IF;

  FOR slug_key IN
    SELECT DISTINCT candidate COLLATE "C" AS candidate
    FROM unnest(ARRAY[OLD."slug", NEW."slug"]) AS keys(candidate)
    ORDER BY candidate
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(slug_key, 0));
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public."DealerProfileSlugHistory" h
    WHERE h."slug" = NEW."slug"
  ) THEN
    RAISE EXCEPTION 'Dealer profile address is permanently reserved'
      USING ERRCODE = '23505', CONSTRAINT = 'DealerProfileSlugHistory_slug_key';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "DealerProfile_slug_guard_before_write"
BEFORE INSERT OR UPDATE OF "slug" ON public."DealerProfile"
FOR EACH ROW EXECUTE FUNCTION public.guard_dealer_profile_slug_write();

CREATE FUNCTION public.guard_dealer_profile_slug_history_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."slug", 0));
  IF EXISTS (
    SELECT 1 FROM public."DealerProfile" d
    WHERE d."slug" = NEW."slug"
  ) THEN
    RAISE EXCEPTION 'Current dealer profile addresses cannot be reserved as historical addresses'
      USING ERRCODE = '23505', CONSTRAINT = 'DealerProfile_slug_key';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DealerProfileSlugHistory_current_slug_guard_before_insert"
BEFORE INSERT ON public."DealerProfileSlugHistory"
FOR EACH ROW EXECUTE FUNCTION public.guard_dealer_profile_slug_history_write();

CREATE FUNCTION public.record_dealer_profile_slug_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD."slug" IS DISTINCT FROM NEW."slug" THEN
    INSERT INTO public."DealerProfileSlugHistory" (
      "id",
      "dealerId",
      "slug",
      "changedAt",
      "countsTowardsLimit"
    )
    VALUES (
      gen_random_uuid()::TEXT,
      OLD."id",
      OLD."slug",
      CURRENT_TIMESTAMP,
      COALESCE(current_setting('app.dealer_profile_address_source', true), '') = 'SELF_SERVICE'
        AND OLD."slug" <> 'dealer-' || OLD."userId"
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DealerProfile_slug_history_after_update"
AFTER UPDATE OF "slug" ON public."DealerProfile"
FOR EACH ROW EXECUTE FUNCTION public.record_dealer_profile_slug_history();

CREATE FUNCTION public.prevent_dealer_profile_slug_history_rewrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dealer profile address history is append-only';
  END IF;

  IF OLD."slug" IS DISTINCT FROM NEW."slug"
    OR OLD."changedAt" IS DISTINCT FROM NEW."changedAt"
    OR OLD."countsTowardsLimit" IS DISTINCT FROM NEW."countsTowardsLimit"
    OR (
      OLD."dealerId" IS DISTINCT FROM NEW."dealerId"
      AND NOT (OLD."dealerId" IS NOT NULL AND NEW."dealerId" IS NULL)
    )
  THEN
    RAISE EXCEPTION 'Dealer profile address history is append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DealerProfileSlugHistory_immutable_before_update_delete"
BEFORE UPDATE OR DELETE ON public."DealerProfileSlugHistory"
FOR EACH ROW EXECUTE FUNCTION public.prevent_dealer_profile_slug_history_rewrite();
