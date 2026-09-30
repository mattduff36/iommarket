import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import { AdminTableHeaderCell } from "@/components/admin/admin-sortable-head";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { PREVIEW_PACK_TABLE_COLUMNS } from "@/lib/admin/table-columns";
import type { AdminSortState } from "@/lib/admin/table-state";
import type { PreviewPackListRow } from "@/lib/preview-packs/archive";
import { PreviewPackActions } from "./preview-pack-actions";

export function PreviewPacksTable({
  rows,
  archiveAvailable,
  sort,
  current,
}: {
  rows: PreviewPackListRow[];
  archiveAvailable: boolean;
  sort: AdminSortState;
  current: Record<string, string | undefined>;
}) {
  return (
    <AdminTable className="min-w-[920px]">
      <TableHeader>
        <TableRow>
          {PREVIEW_PACK_TABLE_COLUMNS.map((column) => (
            <AdminTableHeaderCell
              key={column.id}
              column={column}
              sort={sort}
              pathname="/admin/preview-packs"
              current={current}
              resetPage={false}
            />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.dealerKey}>
            <TableCell data-column="dealer">
              <AdminDataCell title={row.displayName} subtitle={row.dealerKey} />
            </TableCell>
            <TableCell data-column="snapshot" className="text-xs text-text-secondary">
              {row.runId ?? "—"}
            </TableCell>
            <TableCell data-column="importable" className={adminNumericCellClass}>
              {row.importable ?? "—"}
            </TableCell>
            <TableCell data-column="database" className={adminNumericCellClass}>
              {row.listingCount}
            </TableCell>
            <TableCell data-column="vehicles" className={adminNumericCellClass}>
              {row.uniqueVehicles ?? "—"}
            </TableCell>
            <TableCell data-column="status">
              {row.enabled ? (
                <Badge variant="warning">Visible to admins</Badge>
              ) : row.materialized ? (
                <Badge variant="neutral">Hidden</Badge>
              ) : (
                <Badge variant="neutral">Not loaded</Badge>
              )}
            </TableCell>
            <TableCell data-column="visible" className={adminActionsCellClass}>
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
            <AdminTableEmpty colSpan={PREVIEW_PACK_TABLE_COLUMNS.length}>
              No eligible archived dealers found.
            </AdminTableEmpty>
          </TableRow>
        ) : null}
      </TableBody>
    </AdminTable>
  );
}
