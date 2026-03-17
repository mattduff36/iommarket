-- AlterTable
ALTER TABLE "Listing"
ADD COLUMN "trustDeclarationAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "trustDeclarationAcceptedAt" TIMESTAMP(3);
