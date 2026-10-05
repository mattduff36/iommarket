export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
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
  recognisedSubscriptionChargeWhere,
} from "@/lib/payments/records";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import {
  applySamplePaymentVisibility,
  applySampleSubscriptionVisibility,
} from "@/lib/listings/sample-related-visibility";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";

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
  const sampleVisibility = await getSampleVisibility();
  const visibleSubscriptionWhere = applySampleSubscriptionVisibility(
    {},
    sampleVisibility,
  );
  const [
    payments,
    subscriptions,
    paymentTotals,
    chargeTotals,
    attempts,
    attemptTotals,
    activePaidSubscriptions,
  ] =
    await Promise.all([
    db.payment.findMany({
      where: applySamplePaymentVisibility(
        { status: "SUCCEEDED", refundedAt: null },
        sampleVisibility,
      ),
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        listing: { select: { title: true } },
      },
    }),
    db.subscription.findMany({
      where: visibleSubscriptionWhere,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        dealer: { select: { name: true } },
      },
    }),
    db.payment.aggregate({
      where: applySamplePaymentVisibility(
        { status: "SUCCEEDED", refundedAt: null },
        sampleVisibility,
      ),
      _sum: { amount: true },
      _count: true,
    }),
    db.subscriptionCharge.aggregate({
      where: {
        ...recognisedSubscriptionChargeWhere(),
        subscription: { is: visibleSubscriptionWhere },
      },
      _sum: { amount: true },
      _count: true,
    }),
    db.paymentCheckoutAttempt.findMany({
      where: { status: { in: ["OPEN", "RETURNED", "REVIEW"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        payment: {
          select: {
            amount: true,
            listing: { select: { title: true } },
          },
        },
        _count: { select: { observations: true } },
      },
    }),
    db.paymentCheckoutAttempt.aggregate({
      where: { status: { in: ["OPEN", "RETURNED", "REVIEW"] } },
      _sum: { amountPence: true },
      _count: true,
    }),
    db.subscription.count({
      where: {
        ...visibleSubscriptionWhere,
        ...getPaidSubscriptionEntitlementWhere(),
      },
    }),
  ]);

  const totalRevenue =
    ((paymentTotals._sum.amount ?? 0) + (chargeTotals._sum.amount ?? 0)) / 100;
  return (
    <>
      <AdminPageHeader
        title="Revenue"
        description="Recognized revenue includes only provider-verified payments and charges."
        meta={
          <span>
            Generated {new Date().toLocaleString("en-GB")} ·{" "}
            <Link href="/admin/revenue">Refresh</Link>
          </span>
        }
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        <MetricCard label="Total revenue" value={`£${totalRevenue.toLocaleString()}`} />
        <MetricCard
          label="Recognized charges"
          value={paymentTotals._count + chargeTotals._count}
        />
        <MetricCard label="Active paid subscriptions" value={activePaidSubscriptions} />
        <MetricCard
          label="Unresolved checkouts"
          value={`${attemptTotals._count} (£${((attemptTotals._sum.amountPence ?? 0) / 100).toFixed(2)})`}
        />
      </div>

      {attempts.length > 0 ? (
        <section
          className="mb-8"
          aria-labelledby="unresolved-checkouts-heading"
        >
          <h2
            id="unresolved-checkouts-heading"
            className="mb-1 text-sm font-semibold text-text-primary"
          >
            Unresolved checkout activity
          </h2>
          <p className="mb-3 text-xs text-text-secondary">
            These attempts are not recognized revenue until verified
            reconciliation completes.
          </p>
          <AdminTable minWidth="wide">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Listing / product</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Browser return</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((attempt) => (
                <TableRow key={attempt.id}>
                  <TableCell className={adminDateCellClass}>
                    {attempt.createdAt.toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell>
                    {attempt.payment?.listing.title ?? attempt.productCode}
                  </TableCell>
                  <TableCell className={adminNumericCellClass}>
                    £{(attempt.amountPence / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning">{attempt.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-text-tertiary">
                    {attempt._count.observations > 0 ? "Observed" : "None"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        </section>
      ) : null}

      {/* Recognized payments */}
      <section aria-labelledby="recent-payments-heading">
        <h2 id="recent-payments-heading" className="mb-3 text-sm font-semibold text-text-primary">
          Recognized listing payments
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
                <AdminTableEmpty colSpan={6}>No verified payments have been recognized yet.</AdminTableEmpty>
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
