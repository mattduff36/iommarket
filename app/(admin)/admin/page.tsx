export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { expireStaleLiveListings, liveListingWhere } from "@/lib/listings/expiry";
import { OPEN_CANCELLATION_STATUSES } from "@/lib/policy/cancellation";
import {
  AdminActionQueue,
  buildAdminActionQueueItems,
} from "@/components/admin/admin-action-queue";
import {
  AdminDashboardStats,
  buildAdminDashboardStats,
} from "@/components/admin/admin-dashboard-stats";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList,
  Users,
  TrendingUp,
  ArrowRight,
  CreditCard,
  ShieldAlert,
} from "lucide-react";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminDashboardPage() {
  await requireRole("ADMIN");
  await expireStaleLiveListings();

  const now = new Date();
  const liveWhere = liveListingWhere(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalListings,
    listingsAwaitingReview,
    liveListings,
    totalDealers,
    verifiedDealers,
    openReports,
    pendingCustomerReviews,
    pendingResponses,
    openReviewDisputes,
    openCancellations,
    openMonitoringIssues,
    recentPayments,
    totalUsers,
    newUsers7d,
    totalRevenuePence,
    recentListings,
    recentUsers,
    recentReports,
    recentPaymentsList,
  ] = await Promise.all([
    db.listing.count(),
    db.listing.count({
      where: {
        OR: [
          { status: "PENDING" },
          { revisions: { some: { status: "PENDING" } } },
        ],
      },
    }),
    db.listing.count({ where: liveWhere }),
    db.dealerProfile.count(),
    db.dealerProfile.count({ where: { verified: true } }),
    db.report.count({ where: { status: "OPEN" } }),
    db.dealerReview.count({ where: { status: "PENDING" } }),
    db.dealerReviewResponseRevision.count({ where: { status: "PENDING" } }),
    db.dealerReviewDispute.count({ where: { status: "OPEN" } }),
    db.dealerCancellationRequest.count({
      where: { status: { in: [...OPEN_CANCELLATION_STATUSES] } },
    }),
    db.monitoringIssue.count({ where: { status: "OPEN" } }),
    db.payment.count({
      where: {
        status: "SUCCEEDED",
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    db.payment.aggregate({
      where: { status: "SUCCEEDED" },
      _sum: { amount: true },
    }),
    db.listing.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        dealer: { select: { name: true } },
      },
    }),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    db.report.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        reason: true,
        createdAt: true,
        listing: { select: { title: true } },
      },
    }),
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        listing: { select: { title: true } },
      },
    }),
  ]);

  const pendingReviews =
    pendingCustomerReviews + pendingResponses + openReviewDisputes;
  const totalRevenue = (totalRevenuePence._sum.amount ?? 0) / 100;

  const LISTING_STATUS_BADGE: Record<string, "success" | "warning" | "error" | "neutral" | "info"> = {
    DRAFT: "neutral",
    PENDING: "warning",
    APPROVED: "info",
    LIVE: "success",
    EXPIRED: "error",
    TAKEN_DOWN: "error",
    SOLD: "neutral",
  };

  const PAYMENT_STATUS_BADGE: Record<string, "success" | "warning" | "error" | "neutral"> = {
    SUCCEEDED: "success",
    PENDING: "warning",
    FAILED: "error",
    REFUNDED: "neutral",
  };

  const ROLE_BADGE: Record<string, "neutral" | "info" | "warning"> = {
    USER: "neutral",
    DEALER: "info",
    ADMIN: "warning",
  };

  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Prioritise work that needs attention, then review marketplace activity."
        actions={
          <div className="flex h-9 items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3">
            <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            <span className="text-xs font-medium text-emerald-500">
              {newUsers7d} new {newUsers7d === 1 ? "user" : "users"} this week
            </span>
          </div>
        }
      />

      <AdminActionQueue
        items={buildAdminActionQueueItems({
          listingsAwaitingReview,
          openReports,
          pendingReviews,
          openCancellations,
          openMonitoringIssues,
        })}
      />

      <AdminDashboardStats
        stats={buildAdminDashboardStats({
          totalUsers,
          newUsers7d,
          liveListings,
          totalListings,
          totalRevenue,
          recentPayments,
          totalDealers,
          verifiedDealers,
        })}
      />

      {/* Activity feeds */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent listings */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <ClipboardList className="h-4 w-4 text-neon-blue-400" aria-hidden="true" />
              Recent Listings
            </CardTitle>
            <Link href="/admin/listings" className="inline-flex items-center gap-1 text-xs font-medium text-neon-blue-400 hover:underline">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentListings.map((listing) => (
              <div key={listing.id} className="flex min-h-14 items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{listing.title}</p>
                  <p className="mt-0.5 truncate text-xs text-text-tertiary">
                    {listing.dealer?.name ?? listing.user.name ?? listing.user.email}
                    {" \u00b7 "}
                    {listing.createdAt.toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Badge variant={LISTING_STATUS_BADGE[listing.status] ?? "neutral"} className="ml-2 shrink-0">
                  {listing.status}
                </Badge>
              </div>
            ))}
            {recentListings.length === 0 && (
              <AdminEmptyState
                compact
                title="No listings yet"
                description="New listings will appear here."
                className="m-4 min-h-28"
              />
            )}
          </CardContent>
        </Card>

        {/* Recent users */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Users className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              New Users
            </CardTitle>
            <Link href="/admin/users" className="inline-flex items-center gap-1 text-xs font-medium text-neon-blue-400 hover:underline">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentUsers.map((user) => (
              <div key={user.id} className="flex min-h-14 items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/users/${user.id}`} className="block truncate text-sm font-medium text-text-primary hover:underline">
                    {user.name ?? user.email}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-text-tertiary">
                    {user.email}
                    {" \u00b7 "}
                    {user.createdAt.toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Badge variant={ROLE_BADGE[user.role] ?? "neutral"} className="ml-2 shrink-0">
                  {user.role}
                </Badge>
              </div>
            ))}
            {recentUsers.length === 0 && (
              <AdminEmptyState
                compact
                title="No users yet"
                description="New registrations will appear here."
                className="m-4 min-h-28"
              />
            )}
          </CardContent>
        </Card>

        {/* Open reports */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <ShieldAlert
                aria-hidden="true"
                className={`h-4 w-4 ${openReports > 0 ? "text-neon-red-400" : "text-emerald-500"}`}
              />
              Open Reports
            </CardTitle>
            <Link href="/admin/reports" className="inline-flex items-center gap-1 text-xs font-medium text-neon-blue-400 hover:underline">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentReports.map((report) => (
              <div key={report.id} className="flex min-h-14 items-start justify-between gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{report.listing.title}</p>
                  <p className="mt-0.5 truncate text-xs text-text-tertiary">{report.reason}</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
                  {report.createdAt.toLocaleDateString("en-GB")}
                </span>
              </div>
            ))}
            {recentReports.length === 0 && (
              <AdminEmptyState
                compact
                title="No open reports"
                description="The moderation queue is clear."
                className="m-4 min-h-28 border-emerald-500/25"
              />
            )}
          </CardContent>
        </Card>

        {/* Recent payments */}
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 px-4 py-3.5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <CreditCard className="h-4 w-4 text-premium-gold-400" aria-hidden="true" />
              Recent Payments
            </CardTitle>
            <Link href="/admin/payments" className="inline-flex items-center gap-1 text-xs font-medium text-neon-blue-400 hover:underline">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentPaymentsList.map((payment) => (
              <div key={payment.id} className="flex min-h-14 items-center justify-between gap-3 border-b border-border/50 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{payment.listing.title}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-text-tertiary">
                    &pound;{(payment.amount / 100).toFixed(2)}
                    {" \u00b7 "}
                    {payment.createdAt.toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Badge variant={PAYMENT_STATUS_BADGE[payment.status] ?? "neutral"} className="ml-2 shrink-0">
                  {payment.status}
                </Badge>
              </div>
            ))}
            {recentPaymentsList.length === 0 && (
              <AdminEmptyState
                compact
                title="No payments yet"
                description="Successful and pending payments will appear here."
                className="m-4 min-h-28"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
