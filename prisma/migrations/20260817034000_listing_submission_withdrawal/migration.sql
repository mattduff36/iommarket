-- Additive and backward-compatible: older application versions ignore this value.
-- Rollback requires rebuilding the enum after all WITHDRAW events are removed or remapped.
ALTER TYPE "ListingLifecycleAction" ADD VALUE IF NOT EXISTS 'WITHDRAW';
