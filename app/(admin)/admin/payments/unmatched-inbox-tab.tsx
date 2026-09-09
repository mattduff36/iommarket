import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttachInboxForm } from "./attach-inbox-form";

export type UnmatchedInboxRow = {
  id: string;
  createdAt: Date;
  eventType: string;
  linkCode: string | null;
  packageName: string | null;
  amountPence: number | null;
  lastErrorCode: string | null;
  paymentReference: string | null;
};

export function UnmatchedInboxTab({
  rows,
}: {
  rows: UnmatchedInboxRow[];
}) {
  return (
    <>
      <p className="mb-4 text-sm text-text-secondary">
        Failed Ripple inbox rows stay here until an admin attaches a listing-fee
        charge to a specific listing. Do not guess from email or amount.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Received</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Provider pay ref</TableHead>
            <TableHead>Attach</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-sm text-text-tertiary">
                {row.createdAt.toLocaleString("en-GB")}
              </TableCell>
              <TableCell className="text-sm text-text-primary">
                {row.packageName ?? row.linkCode ?? "Unknown"}
              </TableCell>
              <TableCell className="text-sm text-text-primary">
                {row.amountPence == null
                  ? "-"
                  : `£${(row.amountPence / 100).toFixed(2)}`}
              </TableCell>
              <TableCell>
                <Badge variant="error">{row.lastErrorCode ?? "FAILED"}</Badge>
              </TableCell>
              <TableCell className="max-w-[160px] truncate font-mono text-xs text-text-tertiary">
                {row.paymentReference ?? "-"}
              </TableCell>
              <TableCell>
                <AttachInboxForm inboxId={row.id} />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-text-tertiary"
              >
                No unmatched inbox rows.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
