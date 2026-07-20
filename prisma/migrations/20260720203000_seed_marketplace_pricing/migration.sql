-- Seed the DB-backed marketplace prices without replacing values that an
-- administrator has already configured. Amounts are integer pence.
INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
VALUES
  ('listing_fee_pence', '499'::jsonb, CURRENT_TIMESTAMP),
  ('featured_fee_pence', '500'::jsonb, CURRENT_TIMESTAMP),
  ('dealer_starter_monthly_pence', '2999'::jsonb, CURRENT_TIMESTAMP),
  ('dealer_pro_monthly_pence', '4999'::jsonb, CURRENT_TIMESTAMP),
  ('optional_listing_support_pence', '500'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
