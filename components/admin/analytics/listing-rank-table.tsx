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
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { cn } from "@/lib/cn";

export function ListingRankTable({
  label,
  empty,
  barClassName,
  rows,
}: {
  label: string;
  empty: string;
  barClassName: string;
  rows: Array<{ id: string; title: string; seller: string; value: number }>;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <AdminTable>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Listing</TableHead>
          <TableHead>Seller</TableHead>
          <TableHead>{label}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.id}>
            <TableCell className="w-12 text-xs tabular-nums text-text-tertiary">{index + 1}</TableCell>
            <TableCell>
              <AdminDataCell title={row.title} />
            </TableCell>
            <TableCell className="text-text-secondary">{row.seller}</TableCell>
            <TableCell className={adminNumericCellClass}>
              <span className="inline-flex items-center justify-end gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-elevated" aria-hidden="true">
                  <span
                    className={cn("block h-full rounded-full", barClassName)}
                    style={{ width: `${Math.max(6, (row.value / max) * 100)}%` }}
                  />
                </span>
                {row.value.toLocaleString()}
              </span>
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? (
          <TableRow>
            <AdminTableEmpty colSpan={4}>{empty}</AdminTableEmpty>
          </TableRow>
        ) : null}
      </TableBody>
    </AdminTable>
  );
}
