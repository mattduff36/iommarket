-- CreateEnum
CREATE TYPE "DealerReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "DealerReviewerType" AS ENUM ('REGISTERED', 'ANONYMOUS');

-- CreateTable
CREATE TABLE "DealerReview" (
    "id" TEXT NOT NULL,
    "dealerId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "reviewerDeviceId" TEXT,
    "reviewerType" "DealerReviewerType" NOT NULL,
    "reviewerName" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "DealerReviewStatus" NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealerReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealerReview_dealerId_reviewerUserId_key" ON "DealerReview"("dealerId", "reviewerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealerReview_dealerId_reviewerDeviceId_key" ON "DealerReview"("dealerId", "reviewerDeviceId");

-- CreateIndex
CREATE INDEX "DealerReview_dealerId_status_createdAt_idx" ON "DealerReview"("dealerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DealerReview_status_createdAt_idx" ON "DealerReview"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DealerReview" ADD CONSTRAINT "DealerReview_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "DealerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerReview" ADD CONSTRAINT "DealerReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
