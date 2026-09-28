-- Additive compatibility values only; no existing ledger rows are changed.
ALTER TYPE "CostSourceKind" ADD VALUE IF NOT EXISTS 'ACCOUNTS_LEDGER';
ALTER TYPE "CostEmailOutboxStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';
