import { ReceiptText } from "lucide-react";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminRecordLink } from "@/components/admin/admin-record-link";
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
import { CostSourceAudit } from "./cost-source-audit";
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
        title="iTrader cost audit"
        description="See how unsettled project costs build up, what each category contributes, and the detail behind each charge."
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
              Current ledger total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {dashboard.projectedTotalLabel}
            </p>
            <p className="mt-2 text-sm text-text-secondary">All unsettled ledger periods</p>
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
        <CostProviderRefresh isOwner={dashboard.isOwner} sync={dashboard.sync} accountsPreview={dashboard.accountsPreview} />
      </div>

      {dashboard.pendingRequest ? (
        <p className="mb-6 text-sm text-text-secondary">
          Invoice request{" "}
          <AdminRecordLink href={`/admin/costs/confirm/${dashboard.pendingRequest.id}`} className="font-mono">
            {dashboard.pendingRequest.id}
          </AdminRecordLink>{" "}
          is pending for{" "}
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
        <CostUsagePanel sections={dashboard.sections} isOwner={dashboard.isOwner} cursorAudit={dashboard.cursorAudit} />
      ) : null}

      {dashboard.sections.length === 0 && dashboard.isOwner && dashboard.cursorAudit ? <CostSourceAudit audit={dashboard.cursorAudit} /> : null}

      {dashboard.accountsPreview?<p className="mb-6 text-sm text-text-secondary">Isolated preview: Accounts costs are shown for testing. Invoice requests, confirmations and manual entries affect only this preview. Notifications are captured without sending email; no live invoice is created.</p>:null}

      {dashboard.comparison ? (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-text-primary">Accounts comparison</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {([
              ["Usage value", dashboard.comparison.usageValueLabel],
              ["Provider cost", dashboard.comparison.providerCostLabel],
              ["Client charge", dashboard.comparison.clientChargeLabel],
              ["Outstanding", dashboard.comparison.outstandingLabel],
            ] as const).map(([title, value]) => (
              <Card key={title}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-text-secondary">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-text-primary">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-sm text-text-secondary">
            {dashboard.comparison.reconciliation}
            {dashboard.comparison.policyVersion ? ` Policy ${dashboard.comparison.policyVersion}.` : ""}
            {dashboard.comparison.sourceUpdatedAt ? ` Source updated ${dashboard.comparison.sourceUpdatedAt}.` : ""}
            {dashboard.comparison.held !== null ? ` Held ${dashboard.comparison.held}, including unassigned ${dashboard.comparison.unassigned}. FX gaps ${dashboard.comparison.fxMissing}. These counts overlap and are not added together.` : ""}
          </p>
          {dashboard.comparison.gap ? <p className="mt-2 text-sm text-text-secondary">{dashboard.comparison.gap}</p> : null}
        </section>
      ) : null}

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
            Developer controls
          </h2>
          <p className="mb-5 text-sm leading-6 text-text-secondary">
            Record manual charges or retry a failed invoice notification.
          </p>
          <OwnerCostControls
            canRetryEmail={dashboard.pendingRequest?.emailStatus === "FAILED"}
            categories={dashboard.manualCategories}
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
