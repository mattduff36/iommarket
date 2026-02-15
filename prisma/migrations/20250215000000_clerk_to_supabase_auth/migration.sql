-- Rename User.clerkId to authUserId
ALTER TABLE "User" RENAME COLUMN "clerkId" TO "authUserId";

-- Rename index
DROP INDEX IF EXISTS "User_clerkId_key";
DROP INDEX IF EXISTS "User_clerkId_idx";
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");
CREATE INDEX "User_authUserId_idx" ON "User"("authUserId");

-- Replace UserRole enum: BUYER/SELLER -> USER, keep DEALER, ADMIN
CREATE TYPE "UserRole_new" AS ENUM ('USER', 'DEALER', 'ADMIN');

ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole_new" USING (
  CASE role::text
    WHEN 'BUYER' THEN 'USER'::"UserRole_new"
    WHEN 'SELLER' THEN 'USER'::"UserRole_new"
    ELSE role::text::"UserRole_new"
  END
);
ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'USER'::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
