-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('LISTING', 'FEATURED', 'SUPPORT');

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "type" "PaymentType" NOT NULL DEFAULT 'LISTING';
