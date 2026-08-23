export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  listAvailablePreviewArchives,
  listablePreviewPackRows,
  mergePreviewPackRows,
} from "@/lib/preview-packs/archive";
import { PreviewPacksTable } from "./preview-packs-table";

export const metadata: Metadata = { title: "Preview packs | Admin" };

export default async function PreviewPacksPage() {
  const [archive, packs] = await Promise.all([
    listAvailablePreviewArchives(),
    db.dealerPreviewPack.findMany({
      include: {
        _count: { select: { listings: true } },
        dealerProfile: { select: { slug: true } },
      },
      orderBy: { displayName: "asc" },
    }),
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Preview packs</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Toggle each dealer independently. Visible packs appear on the marketplace
          for admin sessions only. Already-loaded packs can be shown or hidden on
          any host. First-time photo upload still needs this PC.
        </p>
        <p className="mt-2 text-xs text-text-tertiary">
          {visibleCount} of {rows.length} visible
          {archive.runId ? ` · latest run ${archive.runId}` : ""}
          {archive.archiveAvailable ? "" : " · archive not on this host"}
        </p>
      </div>

      <PreviewPacksTable
        rows={rows}
        archiveAvailable={archive.archiveAvailable}
      />
    </>
  );
}
