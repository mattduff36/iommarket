-- Expired is an evidence disposition, never proof of a successful repair.
ALTER TYPE "MonitoringIssueStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TABLE "MonitoringIssue" ADD COLUMN IF NOT EXISTS "investigation" JSONB;
