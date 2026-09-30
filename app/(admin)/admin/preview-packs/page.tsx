export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  listAvailablePreviewArchives,
  listablePreviewPackRows,
  mergePreviewPackRows,
} from "@/lib/preview-packs/archive";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import { AdminColumnMenu, AdminColumnVisibility } from "@/components/admin/admin-column-visibility";
import { AdminTableOptions } from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  PREVIEW_PACK_TABLE_COLUMNS,
  PREVIEW_PACK_TABLE_SORT,
} from "@/lib/admin/table-columns";
import { sortPreviewPackRows } from "@/lib/admin/table-order";
import { parseAdminSort } from "@/lib/admin/table-state";
import { PreviewPacksTable } from "./preview-packs-table";
import { SampleListingToggles } from "./sample-listing-toggles";

export const metadata: Metadata = { title: "Preview packs | Admin" };

export default async function PreviewPacksPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const sort = parseAdminSort(params, PREVIEW_PACK_TABLE_COLUMNS, PREVIEW_PACK_TABLE_SORT);
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
  const rows = sortPreviewPackRows(listablePreviewPackRows(
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
  ), sort);
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

      <AdminColumnVisibility tableId="preview-packs" columns={PREVIEW_PACK_TABLE_COLUMNS}>
        <AdminTableOptions>
          <AdminColumnMenu />
        </AdminTableOptions>
        <PreviewPacksTable
          rows={rows}
          archiveAvailable={archive.archiveAvailable}
          sort={sort}
          current={{
            sort: sort.explicit ? sort.column : undefined,
            dir: sort.explicit ? sort.direction : undefined,
          }}
        />
      </AdminColumnVisibility>
    </>
  );
}
