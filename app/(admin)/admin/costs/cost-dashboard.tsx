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
import {
  COST_EMPTY_HELP,
  COST_INVOICE_HELP,
  COST_NON_OWNER_HELP,
  syncHealthDetail,
  syncHealthLabel,
} from "@/lib/costs/copy";
import type { CostDashboardDto } from "@/lib/costs/dto";
import { OwnerCostControls, RequestInvoiceButton } from "./cost-actions";

export function CostDashboardView({ dashboard }: { dashboard: CostDashboardDto }) {
  const syncLabel = syncHealthLabel(dashboard.sync);
  const syncDetail = syncHealthDetail(dashboard.sync);

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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge variant={dashboard.sync.stale ? "warning" : "success"}>
              {syncLabel}
            </Badge>
            <p className="text-sm text-text-secondary">{syncDetail}</p>
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

      {dashboard.enabled && dashboard.sections.length === 0 ? (
        <AdminEmptyState
          icon={ReceiptText}
          title="No cost lines yet"
          description={COST_EMPTY_HELP}
          className="mb-8"
        />
      ) : null}

      {dashboard.sections.map((section) => (
        <section key={section.key} className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text-primary">
              {section.label}
            </h2>
            <p className="text-sm text-text-secondary">{section.amountLabel}</p>
          </div>
          <AdminTable>
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
                  <TableCell className={adminDateCellClass}>
                    {new Date(line.periodStart).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell>{line.label}</TableCell>
                  <TableCell className={adminNumericCellClass}>
                    {line.amountLabel}
                  </TableCell>
                  <TableCell>
                    <Badge variant={line.provisional ? "warning" : "neutral"}>
                      {line.provisional ? "Provisional" : "Invoiceable"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        </section>
      ))}

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

      {dashboard.isOwner ? (
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
