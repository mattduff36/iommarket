import { ReceiptText } from "lucide-react";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CostProviderRefresh } from "./cost-provider-refresh";
import { CostUsagePanel } from "./cost-usage-panel";
import {
  COST_EMPTY_HELP,
  COST_INVOICE_HELP,
  COST_NON_OWNER_HELP,
} from "@/lib/costs/copy";
import type { CostDashboardDto } from "@/lib/costs/dto";
import { OwnerCostControls, RequestInvoiceButton } from "./cost-actions";

export function CostDashboardView({ dashboard }: { dashboard: CostDashboardDto }) {
  if (dashboard.unavailableReason) {
    return (
      <>
        <AdminPageHeader
          title="Costs"
          description="The canonical ledger could not be read. Totals are hidden so an empty local database is not shown as a zero balance."
        />
        <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-6 text-text-secondary">
          {dashboard.unavailableReason}
        </p>
      </>
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Costs"
        description="Review live project costs, invoiceable totals, provider sync health, and invoice requests."
        actions={
          <RequestInvoiceButton
            label={dashboard.requestButtonLabel}
            disabled={!dashboard.canRequestInvoice}
          />
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
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
            <p className="mt-2 text-sm text-text-secondary">{COST_INVOICE_HELP}</p>
          </CardContent>
        </Card>
        <CostProviderRefresh isOwner={dashboard.isOwner} sync={dashboard.sync} />
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

      {dashboard.enabled && dashboard.sections.length === 0 ? (
        <AdminEmptyState
          icon={ReceiptText}
          title="No cost lines yet"
          description={COST_EMPTY_HELP}
          className="mb-8"
        />
      ) : null}

      {dashboard.sections.length > 0 ? (
        <CostUsagePanel sections={dashboard.sections} isOwner={dashboard.isOwner} />
      ) : null}

      <div className="mb-8 rounded-lg border border-border bg-surface p-4 shadow-low">
        <h2 className="text-sm font-medium text-text-secondary">Projected total</h2>
        <p className="mt-2 text-2xl font-bold tabular-nums text-text-primary">
          {dashboard.projectedTotalLabel}
        </p>
      </div>

      {dashboard.requests.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            Invoice requests
          </h2>
          <AdminTable>
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
                  <TableCell className={adminDateCellClass}>
                    {new Date(request.createdAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell className={adminNumericCellClass}>
                    {request.amountLabel}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        request.status === "CONFIRMED" ? "success" : "warning"
                      }
                    >
                      {request.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{request.emailStatus ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        </section>
      ) : null}

      {dashboard.isOwner && !dashboard.affectsLiveLedger ? (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-low sm:p-6">
          <h2 className="mb-1 text-lg font-semibold text-text-primary">
            Owner controls
          </h2>
          <p className="mb-5 text-sm leading-6 text-text-secondary">
            Record manual charges, refresh provider costs, or retry a failed invoice notification.
          </p>
          <OwnerCostControls
            canRetryEmail={dashboard.pendingRequest?.emailStatus === "FAILED"}
            outboxId={dashboard.pendingRequest?.outboxId ?? undefined}
          />
        </section>
      ) : (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-6 text-text-secondary">
          {COST_NON_OWNER_HELP}
        </p>
      )}
    </>
  );
}
