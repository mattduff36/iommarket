import { db } from "@/lib/db";
import { assertIsolatedLocalDatabase } from "@/lib/media/backfill-decision";

const userId = "localimagekituser0001";
const regionId = "localimagekitregion01";
const categoryId = "localimagekitcategory1";
const listingId = "localimagekitlisting01";

async function main() {
  assertIsolatedLocalDatabase(process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "");
  await db.region.upsert({
    where: { id: regionId },
    update: {},
    create: { id: regionId, name: "Local", slug: "local-imagekit" },
  });
  await db.category.upsert({
    where: { id: categoryId },
    update: {},
    create: { id: categoryId, name: "Cars", slug: "local-imagekit-cars" },
  });
  await db.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      authUserId: "local-imagekit-auth",
      email: "local-imagekit@example.com",
      name: "Local ImageKit",
      role: "ADMIN",
    },
  });
  await db.listing.upsert({
    where: { id: listingId },
    update: { status: "LIVE" },
    create: {
      id: listingId,
      userId,
      categoryId,
      regionId,
      title: "Local ImageKit fixture",
      description: "Sanitized listing used to exercise ImageKit delivery.",
      price: 100000,
      status: "LIVE",
    },
  });
  const images = [
    {
      id: "localimagekitimageexact",
      publicId: "iommarket/listings/import/cmrtiqr46000404l45qr9g66b/21255274/1",
      provider: "CLOUDINARY" as const,
      assetId: "56ae2f7f67411b524b813f2b389820b0",
      version: "1787416263",
      url: "https://res.cloudinary.com/du3othqre/image/private/v1787416263/iommarket/listings/import/cmrtiqr46000404l45qr9g66b/21255274/1.jpg",
    },
    {
      id: "localimagekitimageurl",
      publicId: "seed/database-sync-style",
      provider: "EXTERNAL" as const,
      assetId: null,
      version: null,
      url: "https://res.cloudinary.com/du3othqre/image/private/v1787416263/iommarket/listings/import/cmrtiqr46000404l45qr9g66b/21255274/1.jpg",
    },
    {
      id: "localimagekitimagemiss",
      publicId: "seed/not-in-snapshot",
      provider: "EXTERNAL" as const,
      assetId: null,
      version: null,
      url: "https://res.cloudinary.com/du3othqre/image/upload/seed/not-in-snapshot.jpg",
    },
    {
      id: "localimagekitimagebadver",
      publicId: "iommarket/listings/import/cmrtiqr46000404l45qr9g66b/21255274/1-mismatch",
      provider: "CLOUDINARY" as const,
      assetId: "56ae2f7f67411b524b813f2b389820b0",
      version: "1",
      url: "https://res.cloudinary.com/du3othqre/image/private/v1/iommarket/listings/import/cmrtiqr46000404l45qr9g66b/21255274/1.jpg",
    },
  ];
  for (const [order, image] of images.entries()) {
    await db.listingImage.upsert({
      where: { id: image.id },
      update: {},
      create: {
        ...image,
        listingId,
        order,
        width: 1500,
        height: 1000,
        format: "jpg",
        bytes: 204288,
      },
    });
  }
  console.log(JSON.stringify({ listingId, images: images.length }));
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Fixture load failed.");
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
