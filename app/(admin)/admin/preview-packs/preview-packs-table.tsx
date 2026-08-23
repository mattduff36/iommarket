import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
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
    <div className="overflow-x-auto">
      <Table className="min-w-0 md:min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead className={PREVIEW_PACK_DETAIL_COLUMN_CLASS}>Snapshot</TableHead>
            <TableHead className={PREVIEW_PACK_DETAIL_COLUMN_CLASS}>Importable</TableHead>
            <TableHead className={PREVIEW_PACK_DETAIL_COLUMN_CLASS}>In database</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-auto md:w-56">Visible</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.dealerKey}>
              <TableCell>
                <div className="font-medium text-text-primary">{row.displayName}</div>
                <div className="font-mono text-xs text-text-tertiary">{row.dealerKey}</div>
              </TableCell>
              <TableCell className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} text-xs text-text-secondary`}>
                {row.runId ?? "—"}
              </TableCell>
              <TableCell className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} text-sm text-text-secondary`}>
                {row.importable ?? "—"}
              </TableCell>
              <TableCell className={`${PREVIEW_PACK_DETAIL_COLUMN_CLASS} text-sm text-text-secondary`}>
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
                    archiveAvailable={archiveAvailable}
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
  );
}
