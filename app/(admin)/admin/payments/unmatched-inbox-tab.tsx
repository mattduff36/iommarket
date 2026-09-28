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
import { AttachInboxForm } from "./attach-inbox-form";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

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
        Check the exact transaction reference in Ripple first. Only attach a
        currently paid, unrefunded listing fee to the seller-confirmed listing.
        A received webhook does not prove the payment has not since been refunded.
        Do not guess from email or amount.
      </p>
      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            <TableHead>Received</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Provider pay ref</TableHead>
            <TableHead className={adminActionsCellClass}>Attach</TableHead>
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
                {row.status === "FAILED" && row.eventType === "payment.received" &&
                row.linkCode === RIPPLE_CANONICAL_PRODUCTS.listing.code &&
                row.amountPence === RIPPLE_CANONICAL_PRODUCTS.listing.amountPence &&
                row.currency?.toLowerCase() === "gbp" && row.paymentReference ? (
                  <AttachInboxForm inboxId={row.id} />
                ) : (
                  <span className="text-xs text-text-secondary">
                    Not eligible for listing-fee attachment
                  </span>
                )}
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
