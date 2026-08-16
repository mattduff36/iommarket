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
    pendingReviews,
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-sm text-text-tertiary mt-1">Actions requiring attention, then site overview</p>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-500" />
          <span className="text-sm text-emerald-500 font-medium">{newUsers7d} new users this week</span>
        </div>
      </div>

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
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent listings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-neon-blue-400" />
              Recent Listings
            </CardTitle>
            <Link href="/admin/listings" className="text-xs text-neon-blue-400 hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentListings.map((listing) => (
              <div key={listing.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary truncate">{listing.title}</p>
                  <p className="text-xs text-text-tertiary">
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
              <p className="text-sm text-text-tertiary text-center py-4">No listings yet</p>
            )}
          </CardContent>
        </Card>

        {/* Recent users */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" />
              New Users
            </CardTitle>
            <Link href="/admin/users" className="text-xs text-neon-blue-400 hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/users/${user.id}`} className="text-sm text-text-primary hover:underline truncate block">
                    {user.name ?? user.email}
                  </Link>
                  <p className="text-xs text-text-tertiary">
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
              <p className="text-sm text-text-tertiary text-center py-4">No users yet</p>
            )}
          </CardContent>
        </Card>

        {/* Open reports */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <ShieldAlert className={`h-4 w-4 ${openReports > 0 ? "text-neon-red-400" : "text-text-tertiary"}`} />
              Open Reports
            </CardTitle>
            <Link href="/admin/reports" className="text-xs text-neon-blue-400 hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentReports.map((report) => (
              <div key={report.id} className="flex items-start justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary truncate">{report.listing.title}</p>
                  <p className="text-xs text-text-tertiary truncate">{report.reason}</p>
                </div>
                <span className="text-[11px] text-text-tertiary shrink-0 ml-2">
                  {report.createdAt.toLocaleDateString("en-GB")}
                </span>
              </div>
            ))}
            {recentReports.length === 0 && (
              <p className="text-sm text-emerald-500 text-center py-4">No open reports</p>
            )}
          </CardContent>
        </Card>

        {/* Recent payments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-premium-gold-400" />
              Recent Payments
            </CardTitle>
            <Link href="/admin/payments" className="text-xs text-neon-blue-400 hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentPaymentsList.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary truncate">{payment.listing.title}</p>
                  <p className="text-xs text-text-tertiary">
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
              <p className="text-sm text-text-tertiary text-center py-4">No payments yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
