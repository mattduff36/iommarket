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
      <h1 className="text-2xl font-bold text-text-primary mb-3">Costs</h1>

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

      <div className="mb-8">
        <RequestInvoiceButton
          label={dashboard.requestButtonLabel}
          disabled={!dashboard.canRequestInvoice}
        />
      </div>

      {dashboard.enabled && dashboard.sections.length === 0 ? (
        <p className="mb-8 text-sm text-text-secondary">{COST_EMPTY_HELP}</p>
      ) : null}

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
                  <TableCell>{request.emailStatus ?? "-"}</TableCell>
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
      ) : (
        <p className="text-sm text-text-secondary">{COST_NON_OWNER_HELP}</p>
      )}
    </>
  );
}
