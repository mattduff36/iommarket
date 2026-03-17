-- CreateEnum
CREATE TYPE "DealerTier" AS ENUM ('STARTER', 'PRO');

-- AlterTable
ALTER TABLE "DealerProfile"
ADD COLUMN "tier" "DealerTier" NOT NULL DEFAULT 'STARTER';
