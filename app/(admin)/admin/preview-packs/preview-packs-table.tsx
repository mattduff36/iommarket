import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import type { PreviewPackListRow } from "@/lib/preview-packs/archive";
import { PreviewPackActions } from "./preview-pack-actions";

const PREVIEW_PACK_DETAIL_COLUMN_CLASS = "hidden md:table-cell";

export function PreviewPacksTable({
  rows,
  archiveAvailable,
}: {
  rows: PreviewPackListRow[];
  archiveAvailable: boolean;
}) {
  return (
    <AdminTable className="min-w-0 md:min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead className={PREVIEW_PACK_DETAIL_COLUMN_CLASS}>Snapshot</TableHead>
            <TableHead className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} text-right`}>Importable</TableHead>
            <TableHead className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} text-right`}>In database</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className={adminActionsCellClass}>Visible</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.dealerKey}>
              <TableCell>
                <AdminDataCell title={row.displayName} subtitle={row.dealerKey} />
              </TableCell>
              <TableCell className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} text-xs text-text-secondary`}>
                {row.runId ?? "—"}
              </TableCell>
              <TableCell className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} ${adminNumericCellClass}`}>
                {row.importable ?? "—"}
              </TableCell>
              <TableCell className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} ${adminNumericCellClass}`}>
                {row.listingCount}
              </TableCell>
              <TableCell>
                {row.enabled ? (
                  <Badge variant="warning">Visible to admins</Badge>
                ) : row.materialized ? (
                  <Badge variant="neutral">Hidden</Badge>
                ) : (
                  <Badge variant="neutral">Not loaded</Badge>
                )}
              </TableCell>
              <TableCell className={adminActionsCellClass}>
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
                    archiveAvailable={archiveAvailable}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <AdminTableEmpty colSpan={6}>No eligible archived dealers found.</AdminTableEmpty>
            </TableRow>
          ) : null}
        </TableBody>
    </AdminTable>
  );
}
