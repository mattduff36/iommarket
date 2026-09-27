export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
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
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { Badge } from "@/components/ui/badge";
import {
  getPaymentDisplayId,
  getProviderLabel,
  getSubscriptionDisplayId,
  isPaidSubscriptionRecord,
} from "@/lib/payments/records";

export const metadata: Metadata = { title: "Revenue" };

const PAYMENT_STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  SUCCEEDED: "success",
  PENDING: "warning",
  FAILED: "error",
  REFUNDED: "neutral",
};

const SUBSCRIPTION_STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "error" | "neutral"
> = {
  ACTIVE: "success",
  PAST_DUE: "warning",
  CANCELLED: "error",
  INCOMPLETE: "neutral",
};

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-[-0.02em] tabular-nums text-text-primary">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AdminRevenuePage() {
  const [payments, subscriptions, totals] = await Promise.all([
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        listing: { select: { title: true } },
      },
    }),
    db.subscription.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        dealer: { select: { name: true } },
      },
    }),
    db.payment.aggregate({
      where: { status: "SUCCEEDED" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const totalRevenue = (totals._sum.amount ?? 0) / 100;
  const activePaidSubscriptions = subscriptions.filter(
    (subscription) =>
      isPaidSubscriptionRecord(subscription) &&
      subscription.status === "ACTIVE",
  ).length;

  return (
    <>
      <AdminPageHeader
        title="Revenue"
        description="Review marketplace payments, provider references, and dealer subscription access."
        meta={<span>Showing the 50 most recent records in each feed</span>}
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Total revenue" value={`£${totalRevenue.toLocaleString()}`} />
        <MetricCard label="Successful payments" value={totals._count} />
        <MetricCard label="Active paid subscriptions" value={activePaidSubscriptions} />
      </div>

      {/* Payments */}
      <section aria-labelledby="recent-payments-heading">
        <h2 id="recent-payments-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Recent payments
        </h2>
        <AdminTable minWidth="wide">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Listing</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Provider Ref</TableHead>
              <TableHead>Provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className={adminDateCellClass}>
                  {payment.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell>
                  <AdminDataCell
                    title={<span className="block max-w-56 truncate">{payment.listing.title}</span>}
                  />
                </TableCell>
                <TableCell className={adminNumericCellClass}>
                  £{(payment.amount / 100).toFixed(2)}
                </TableCell>
                <TableCell>
                  <Badge variant={PAYMENT_STATUS_VARIANT[payment.status] ?? "neutral"}>
                    {payment.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[160px] truncate font-mono text-xs text-text-tertiary">
                  {getPaymentDisplayId(payment)}
                </TableCell>
                <TableCell className="text-xs text-text-tertiary">
                  {getProviderLabel(payment.paymentProvider)}
                </TableCell>
              </TableRow>
            ))}
            {payments.length === 0 ? (
              <TableRow>
                <AdminTableEmpty colSpan={6}>No payments have been recorded yet.</AdminTableEmpty>
              </TableRow>
            ) : null}
          </TableBody>
        </AdminTable>
      </section>

      {/* Subscriptions */}
      <section className="mt-8" aria-labelledby="dealer-subscriptions-heading">
        <h2 id="dealer-subscriptions-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Dealer subscriptions
        </h2>
        <AdminTable minWidth="wide">
          <TableHeader>
            <TableRow>
              <TableHead>Dealer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period End</TableHead>
              <TableHead>Provider Ref</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell>
                  <AdminDataCell title={sub.dealer.name} />
                </TableCell>
                <TableCell>
                  <Badge
                    variant={SUBSCRIPTION_STATUS_VARIANT[sub.status] ?? "neutral"}
                  >
                    {sub.status}
                  </Badge>
                </TableCell>
                <TableCell className={adminDateCellClass}>
                  {sub.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "-"}
                </TableCell>
                <TableCell className="max-w-[160px] truncate font-mono text-xs text-text-tertiary">
                  {getSubscriptionDisplayId(sub)}
                </TableCell>
                <TableCell className="text-xs text-text-tertiary">
                  {getProviderLabel(sub.paymentProvider)}
                </TableCell>
                <TableCell className="text-xs text-text-tertiary">
                  {sub.source === "ADMIN_GRANT" ? "Free admin grant" : "Paid"}
                </TableCell>
              </TableRow>
            ))}
            {subscriptions.length === 0 ? (
              <TableRow>
                <AdminTableEmpty colSpan={6}>No dealer subscriptions have been recorded yet.</AdminTableEmpty>
              </TableRow>
            ) : null}
          </TableBody>
        </AdminTable>
      </section>
    </>
  );
}
