CREATE TABLE "SignupRateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SignupRateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "SignupRateLimitBucket_resetAt_idx"
    ON "SignupRateLimitBucket"("resetAt");

ALTER TABLE "public"."SignupRateLimitBucket" ENABLE ROW LEVEL SECURITY;
