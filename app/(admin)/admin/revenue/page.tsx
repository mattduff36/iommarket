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
import { AdminRecordLink } from "@/components/admin/admin-record-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { dealerAdminHref, listingReviewHref } from "@/lib/admin/record-href";
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
  recognisedListingPaymentWhere,
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

function MetricCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card className="@container/metric relative min-w-0 overflow-hidden rounded-none border-0 shadow-none sm:rounded-lg sm:border sm:border-border sm:shadow-low">
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] sm:hidden ${accent}`} />
      <CardContent className="min-w-0 p-3 sm:p-5">
        <p className="break-words text-[11px] leading-4 text-text-secondary sm:text-xs sm:font-medium">{label}</p>
        <p className="mt-1 min-w-0 break-words text-[clamp(0.75rem,10cqi,1.5rem)] font-bold leading-tight tracking-[-0.02em] tabular-nums text-text-primary [overflow-wrap:anywhere] sm:mt-2 sm:leading-8">
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
        recognisedListingPaymentWhere(),
        sampleVisibility,
      ),
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        listing: { select: { id: true, title: true } },
      },
    }),
    db.subscription.findMany({
      where: visibleSubscriptionWhere,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        dealer: { select: { id: true, name: true } },
      },
    }),
    db.payment.aggregate({
      where: applySamplePaymentVisibility(
        recognisedListingPaymentWhere(),
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
            listing: { select: { id: true, title: true } },
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

      <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
        <MetricCard label="Total revenue" value={`£${totalRevenue.toLocaleString()}`} accent="bg-premium-gold-500" />
        <MetricCard
          label="Recognized charges"
          value={paymentTotals._count + chargeTotals._count}
          accent="bg-neon-blue-500"
        />
        <MetricCard label="Active paid subscriptions" value={activePaidSubscriptions} accent="bg-emerald-500" />
        <MetricCard
          label="Unresolved checkouts"
          value={`${attemptTotals._count} (£${((attemptTotals._sum.amountPence ?? 0) / 100).toFixed(2)})`}
          accent={attemptTotals._count > 0 ? "bg-neon-red-500" : "bg-emerald-500"}
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
                    {attempt.payment?.listing ? (
                      <AdminRecordLink
                        href={listingReviewHref(attempt.payment.listing.id)}
                        external
                      >
                        {attempt.payment.listing.title}
                      </AdminRecordLink>
                    ) : (
                      attempt.productCode
                    )}
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
                    title={
                      <AdminRecordLink
                        href={listingReviewHref(payment.listing.id)}
                        external
                        className="block max-w-56 truncate"
                      >
                        {payment.listing.title}
                      </AdminRecordLink>
                    }
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
                  <AdminDataCell
                    title={
                      <AdminRecordLink href={dealerAdminHref(sub.dealer.id)}>
                        {sub.dealer.name}
                      </AdminRecordLink>
                    }
                  />
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
