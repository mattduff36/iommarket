export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  listAvailablePreviewArchives,
  mergePreviewPackRows,
} from "@/lib/preview-packs/archive";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { PreviewPackActions } from "./preview-pack-actions";

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
  const rows = mergePreviewPackRows({
    archives: archive.dealers,
    packs: packs.map((pack) => ({
      dealerKey: pack.dealerKey,
      displayName: pack.displayName,
      enabled: pack.enabled,
      sourceRunId: pack.sourceRunId,
      listingCount: pack._count.listings,
      slug: pack.dealerProfile.slug,
    })),
  });
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

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dealer</TableHead>
              <TableHead>Snapshot</TableHead>
              <TableHead>Importable</TableHead>
              <TableHead>In database</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-56">Visible</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.dealerKey}>
                <TableCell>
                  <div className="font-medium text-text-primary">{row.displayName}</div>
                  <div className="font-mono text-xs text-text-tertiary">{row.dealerKey}</div>
                </TableCell>
                <TableCell className="text-xs text-text-secondary">{row.runId ?? "—"}</TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {row.importable ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-text-secondary">{row.listingCount}</TableCell>
                <TableCell>
                  {row.enabled ? (
                    <Badge variant="warning">Visible to admins</Badge>
                  ) : row.materialized ? (
                    <Badge variant="neutral">Hidden</Badge>
                  ) : (
                    <Badge variant="neutral">Not loaded</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-end gap-2">
                    {row.slug ? (
                      <Link
                        href={`/dealers/${row.slug}`}
                        className="text-xs text-neon-blue-400 hover:text-neon-blue-500"
                      >
                        View dealer
                      </Link>
                    ) : null}
                    <PreviewPackActions
                      dealerKey={row.dealerKey}
                      displayName={row.displayName}
                      enabled={row.enabled}
                      loaded={row.loaded}
                      materialized={row.materialized}
                      archiveAvailable={archive.archiveAvailable}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-text-tertiary">
                  No eligible archived dealers found. Ocean Motor Village is excluded on purpose.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
