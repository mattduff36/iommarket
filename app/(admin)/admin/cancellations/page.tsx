export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
} from "@/components/admin/admin-table";
import { CancellationActions } from "./cancellation-actions";

export const metadata: Metadata = { title: "Cancellation Requests" };

const STATUS_VARIANT: Record<
  string,
  "warning" | "info" | "success" | "error" | "neutral"
> = {
  REQUESTED: "warning",
  ACKNOWLEDGED: "info",
  RECONCILED: "info",
  COMPLETED: "success",
  REJECTED: "error",
};

export default async function AdminCancellationsPage() {
  const requests = await db.dealerCancellationRequest.findMany({
    orderBy: { requestedAt: "desc" },
    take: 50,
    include: {
      dealer: { select: { name: true, slug: true } },
      subscription: {
        select: {
          status: true,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: true,
          providerLifecycle: true,
        },
      },
    },
  });

  return (
    <>
      <AdminPageHeader
        title="Dealer cancellation requests"
        description="Acknowledge means staff have started or verified the Ripple change; it is not an in-app provider cancellation. Completion still requires provider cancellation and an expired paid period."
        meta={
          <>
            <span>{requests.length} most recent requests</span>
            <Link href="/refunds" className="text-text-trust hover:underline">
              Refund Policy
            </Link>
          </>
        }
      />

      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Period end</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead className={adminActionsCellClass}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell>
                <AdminDataCell
                  title={
                    <Link
                      href={`/dealers/${request.dealer.slug}`}
                      className="text-text-trust hover:underline"
                    >
                      {request.dealer.name}
                    </Link>
                  }
                  subtitle={request.dealer.slug}
                />
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[request.status] ?? "neutral"}>
                  {request.status}
                </Badge>
              </TableCell>
              <TableCell className={adminDateCellClass}>
                {request.periodEndAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className="text-xs text-text-secondary">
                {request.subscription.status}
                {request.subscription.cancelAtPeriodEnd ? " · period-end" : ""}
              </TableCell>
              <TableCell className={adminDateCellClass}>
                {request.requestedAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className={`${adminActionsCellClass} min-w-[220px]`}>
                <CancellationActions
                  requestId={request.id}
                  status={request.status}
                />
              </TableCell>
            </TableRow>
          ))}
          {requests.length === 0 ? (
            <TableRow>
              <AdminTableEmpty colSpan={6}>
                No dealer cancellation requests found.
              </AdminTableEmpty>
            </TableRow>
          ) : null}
        </TableBody>
      </AdminTable>
    </>
  );
}
