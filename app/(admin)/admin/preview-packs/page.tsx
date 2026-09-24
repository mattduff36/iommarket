export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  listAvailablePreviewArchives,
  listablePreviewPackRows,
  mergePreviewPackRows,
} from "@/lib/preview-packs/archive";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PreviewPacksTable } from "./preview-packs-table";
import { SampleListingToggles } from "./sample-listing-toggles";

export const metadata: Metadata = { title: "Preview packs | Admin" };

export default async function PreviewPacksPage() {
  const [archive, packs, sampleVisibility] = await Promise.all([
    listAvailablePreviewArchives(),
    db.dealerPreviewPack.findMany({
      include: {
        _count: { select: { listings: true } },
        dealerProfile: { select: { slug: true } },
      },
      orderBy: { displayName: "asc" },
    }),
    getSampleVisibility(),
  ]);
  const rows = listablePreviewPackRows(
    mergePreviewPackRows({
      archives: archive.dealers,
      packs: packs.map((pack) => ({
        dealerKey: pack.dealerKey,
        displayName: pack.displayName,
        enabled: pack.enabled,
        sourceRunId: pack.sourceRunId,
        listingCount: pack._count.listings,
        slug: pack.dealerProfile.slug,
      })),
    }),
  );
  const visibleCount = rows.filter((row) => row.enabled).length;

  return (
    <>
      <AdminPageHeader
        title="Preview packs"
        description="Control dealer preview data shown to admin sessions. Loaded packs can be toggled on any host; first-time photo upload still needs this PC."
        meta={
          <>
            <span>{visibleCount} of {rows.length} visible</span>
            {archive.runId ? <span>Latest run {archive.runId}</span> : null}
            {!archive.archiveAvailable ? <span>Archive unavailable on this host</span> : null}
          </>
        }
      />

      <SampleListingToggles
        samplePrivateVisible={sampleVisibility.privateListings}
        sampleDealerVisible={sampleVisibility.dealerListings}
      />

      <PreviewPacksTable
        rows={rows}
        archiveAvailable={archive.archiveAvailable}
      />
    </>
  );
}
