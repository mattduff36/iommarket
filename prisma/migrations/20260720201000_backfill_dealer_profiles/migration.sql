-- Repair legacy dealer-role accounts that predate atomic dealer provisioning.
-- Profile defaults are deterministic so the migration is safe to apply once.
DO $$
DECLARE
  dealer_user RECORD;
  candidate_name TEXT;
  candidate_slug TEXT;
  slug_suffix INTEGER;
BEGIN
  FOR dealer_user IN
    SELECT user_record."id", user_record."name", user_record."email"
    FROM "User" AS user_record
    LEFT JOIN "DealerProfile" AS profile
      ON profile."userId" = user_record."id"
    WHERE user_record."role" = 'DEALER'
      AND profile."id" IS NULL
  LOOP
    candidate_name := CASE
      WHEN CHAR_LENGTH(BTRIM(COALESCE(dealer_user."name", ''))) >= 2
        THEN LEFT(BTRIM(dealer_user."name"), 100)
      WHEN CHAR_LENGTH(BTRIM(SPLIT_PART(dealer_user."email", '@', 1))) >= 2
        THEN LEFT(BTRIM(SPLIT_PART(dealer_user."email", '@', 1)), 100)
      ELSE CONCAT('Dealer ', RIGHT(dealer_user."id", 6))
    END;

    candidate_slug := CONCAT('dealer-', dealer_user."id");
    slug_suffix := 0;
    WHILE EXISTS (
      SELECT 1
      FROM "DealerProfile"
      WHERE "slug" = candidate_slug
    ) LOOP
      slug_suffix := slug_suffix + 1;
      candidate_slug := LEFT(
        CONCAT('dealer-', dealer_user."id", '-', slug_suffix),
        100
      );
    END LOOP;

    INSERT INTO "DealerProfile" (
      "id",
      "userId",
      "name",
      "slug",
      "verified",
      "tier",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      CONCAT('dealer_backfill_', MD5(dealer_user."id")),
      dealer_user."id",
      candidate_name,
      candidate_slug,
      false,
      'STARTER',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId") DO NOTHING;
  END LOOP;
END $$;
