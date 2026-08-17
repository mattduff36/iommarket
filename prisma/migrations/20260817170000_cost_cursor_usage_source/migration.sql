-- Additive provenance value for Cursor subscription allocation entries.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'CostSourceKind'
      AND pg_enum.enumlabel = 'CURSOR_USAGE'
  ) THEN
    ALTER TYPE "CostSourceKind" ADD VALUE 'CURSOR_USAGE';
  END IF;
END
$$;
