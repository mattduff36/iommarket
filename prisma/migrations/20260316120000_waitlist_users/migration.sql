-- CreateTable
CREATE TABLE "WaitlistUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "interests" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'coming_soon_page',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistUser_email_key" ON "WaitlistUser"("email");

-- CreateIndex
CREATE INDEX "WaitlistUser_email_idx" ON "WaitlistUser"("email");

-- CreateIndex
CREATE INDEX "WaitlistUser_createdAt_idx" ON "WaitlistUser"("createdAt");
