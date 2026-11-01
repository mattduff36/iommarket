import { db } from "@/lib/db";

/** Analytics must not advance Listing.updatedAt: stock reviews use it as an edit fence. */
export async function recordListingView(input: {
  listingId: string;
  viewerId?: string;
  viewerHash: string;
  viewerHashVersion: number;
}) {
  await db.$transaction(async (tx) => {
    // Prisma's normal update also advances @updatedAt. Increment only this counter,
    // without writing back a previously read timestamp that could hide a concurrent edit.
    const changed = await tx.$executeRaw`
      UPDATE "Listing" SET "viewCount" = "viewCount" + 1 WHERE "id" = ${input.listingId}
    `;
    if (changed !== 1) throw new Error("Listing unavailable while recording a view.");
    await tx.listingView.create({ data: input });
  });
}
