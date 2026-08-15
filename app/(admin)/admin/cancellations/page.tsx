export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
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
      <h1 className="text-2xl font-bold text-text-primary mb-2">
        Dealer cancellation requests
      </h1>
      <p className="mb-6 text-sm text-text-secondary">
        Acknowledge means staff have started or verified the Ripple change. Do
        not treat Acknowledge as an in-app provider cancellation. Completion
        requires provider cancellation and an expired paid period. See the{" "}
        <Link href="/refunds" className="text-text-trust hover:underline">
          Refund Policy
        </Link>
        .
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Period end</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell>
                <Link
                  href={`/dealers/${request.dealer.slug}`}
                  className="text-text-trust hover:underline"
                >
                  {request.dealer.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[request.status] ?? "neutral"}>
                  {request.status}
                </Badge>
              </TableCell>
              <TableCell>
                {request.periodEndAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className="text-xs text-text-secondary">
                {request.subscription.status}
                {request.subscription.cancelAtPeriodEnd ? " · period-end" : ""}
              </TableCell>
              <TableCell>
                {request.requestedAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className="min-w-[220px]">
                <CancellationActions
                  requestId={request.id}
                  status={request.status}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
