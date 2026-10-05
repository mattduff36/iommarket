import { Badge } from "@/components/ui/badge";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";

export type UnmatchedInboxRow = {
  id: string;
  createdAt: Date;
  eventType: string;
  linkCode: string | null;
  packageName: string | null;
  amountPence: number | null;
  lastErrorCode: string | null;
  paymentReference: string | null;
  customerEmailNorm: string | null;
  currency: string | null;
  status: string;
};

export function UnmatchedInboxTab({
  rows,
}: {
  rows: UnmatchedInboxRow[];
}) {
  return (
    <>
      <p className="mb-4 text-sm text-text-secondary">
        These receipts cannot be attached directly because they do not contain
        a trustworthy signed checkout reference. Use the reconciliation queue
        only when a persisted checkout attempt identifies the payment.
      </p>
      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            <TableHead>Received</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Provider pay ref</TableHead>
            <TableHead className={adminActionsCellClass}>Recovery</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className={adminDateCellClass}>
                {row.createdAt.toLocaleString("en-GB")}
              </TableCell>
              <TableCell className="text-sm text-text-primary">
                {row.packageName ?? row.linkCode ?? "Unknown"}
                <p className="mt-1 text-xs text-text-secondary">
                  {row.customerEmailNorm ?? "Payer email unavailable"}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">{row.eventType}</p>
              </TableCell>
              <TableCell className={adminNumericCellClass}>
                {row.amountPence == null
                  ? "-"
                  : `£${(row.amountPence / 100).toFixed(2)}`}
              </TableCell>
              <TableCell>
                <Badge variant="error">{row.lastErrorCode ?? "FAILED"}</Badge>
              </TableCell>
              <TableCell className="break-all font-mono text-xs text-text-tertiary">
                {row.paymentReference ?? "-"}
              </TableCell>
              <TableCell className={adminActionsCellClass}>
                <span className="text-xs text-text-secondary">
                  Use reconciliation queue
                </span>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={6}>No unmatched inbox rows.</AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>
    </>
  );
}
