export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isCostOwner, isCostsEnabled } from "@/lib/costs/config";
import { getCostDashboard } from "@/lib/costs/queries";
import { db } from "@/lib/db";
import { OwnerCostControls, RequestInvoiceButton } from "./cost-actions";

export const metadata: Metadata = { title: "Costs | Admin" };

export default async function AdminCostsPage() {
  const admin = await requireRole("ADMIN");
  const enabled = isCostsEnabled();
  const dashboard = await getCostDashboard({
    db,
    enabled,
    isOwner: isCostOwner(admin.authUserId),
  });

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Costs</h1>

      {!dashboard.enabled ? (
        <p className="text-text-secondary">
          Project cost tracking is not enabled yet. It will start on the next
          configured billing-period boundary.
        </p>
      ) : null}

      {dashboard.enabled && dashboard.startedAt ? (
        <p className="mb-6 text-sm text-text-secondary">
          Ledger start: {new Date(dashboard.startedAt).toLocaleDateString("en-GB")}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Current live total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {dashboard.projectedTotalLabel}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Outstanding invoiceable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {dashboard.invoiceableTotalLabel}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge variant={dashboard.sync.stale ? "warning" : "success"}>
              {dashboard.sync.stale ? "Stale or failed" : dashboard.sync.status}
            </Badge>
            {dashboard.sync.quarantinedCount > 0 ? (
              <p className="text-sm text-text-secondary">
                {dashboard.sync.quarantinedCount} quarantined provider rows
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {dashboard.pendingRequest ? (
        <p className="mb-6 text-sm text-text-secondary">
          Invoice request {dashboard.pendingRequest.id} is pending for{" "}
          {dashboard.pendingRequest.amountLabel}
          {dashboard.pendingRequest.emailStatus === "FAILED"
            ? " and the notification email failed."
            : "."}
        </p>
      ) : null}

      <div className="mb-8">
        <RequestInvoiceButton
          label={dashboard.requestButtonLabel}
          disabled={!dashboard.canRequestInvoice}
        />
      </div>

      {dashboard.sections.map((section) => (
        <section key={section.key} className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text-primary">
              {section.label}
            </h2>
            <p className="text-sm text-text-secondary">{section.amountLabel}</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    {new Date(line.periodStart).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell>{line.label}</TableCell>
                  <TableCell>{line.amountLabel}</TableCell>
                  <TableCell>
                    <Badge variant={line.provisional ? "warning" : "neutral"}>
                      {line.provisional ? "Provisional" : "Invoiceable"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}

      <div className="mb-8">
        <h2 className="text-lg font-semibold text-text-primary mb-3">Total</h2>
        <p className="text-2xl font-bold text-text-primary">
          {dashboard.projectedTotalLabel}
        </p>
      </div>

      {dashboard.requests.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            Invoice requests
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    {new Date(request.createdAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell>{request.amountLabel}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        request.status === "CONFIRMED" ? "success" : "warning"
                      }
                    >
                      {request.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{request.emailStatus ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {dashboard.isOwner ? (
        <section>
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            Owner controls
          </h2>
          <OwnerCostControls
            canRetryEmail={dashboard.pendingRequest?.emailStatus === "FAILED"}
            outboxId={dashboard.pendingRequest?.outboxId ?? undefined}
          />
        </section>
      ) : null}
    </>
  );
}
