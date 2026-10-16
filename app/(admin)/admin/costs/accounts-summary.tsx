import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccountsCostDashboardResult } from "@/lib/costs/accounts-reader";
import { formatMarkedGbp } from "@/lib/costs/format";
import { costBillingHasPlot, toCostBillingDisplay } from "@/lib/costs/usage-view";
import { CostUsagePanel } from "./cost-usage-panel";

const PAGE_DESCRIPTION = "See how project costs build up, what each category contributes, and the detail behind each charge.";

function formatSuppliedPence(pence: number | null): string {
  if (pence === null || !Number.isSafeInteger(pence)) return "Unavailable";
  return formatMarkedGbp(pence);
}

function formatSourceUpdated(value: string | null): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} UK`;
}

function MoneyCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-text-secondary">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-text-primary">{value}</p>
      </CardContent>
    </Card>
  );
}

export function AccountsProjectSummaryView({ dashboard }: { dashboard: AccountsCostDashboardResult }) {
  if (!dashboard.available) {
    return (
      <>
        <AdminPageHeader title="iTrader cost audit" description={PAGE_DESCRIPTION} />
        <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-6 text-text-secondary">
          Project costs are unavailable.
        </p>
      </>
    );
  }

  const billing = toCostBillingDisplay(dashboard);
  const sections = dashboard.chartAvailable ? dashboard.sections : [];
  const chart = sections.length > 0 || costBillingHasPlot(billing)
    ? <CostUsagePanel sections={sections} isOwner={false} billing={billing} costDetailsAvailable={dashboard.chartAvailable} />
    : (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm leading-6 text-text-secondary">
        {dashboard.chartAvailable ? "No cost lines to show." : "Usage detail is unavailable."}
      </p>
    );

  return (
    <>
      <AdminPageHeader title="iTrader cost audit" description={PAGE_DESCRIPTION} />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MoneyCard title="Project costs" value={formatSuppliedPence(dashboard.costTotalPence)} />
        <MoneyCard title="Invoiced" value={formatSuppliedPence(dashboard.invoicedPence)} />
        <MoneyCard title="Remaining to invoice" value={formatSuppliedPence(dashboard.remainingToInvoicePence)} />
        <MoneyCard title="Last updated" value={formatSourceUpdated(dashboard.sourceUpdatedAt ?? dashboard.asOf)} />
      </div>
      {chart}
    </>
  );
}
