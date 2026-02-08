export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Revenue" };

const PAYMENT_STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  SUCCEEDED: "success",
  PENDING: "warning",
  FAILED: "error",
  REFUNDED: "neutral",
};

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

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Revenue</h1>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              £{totalRevenue.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Successful Payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {totals._count}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-text-secondary">
              Active Subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-text-primary">
              {subscriptions.filter((s) => s.status === "ACTIVE").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payments */}
      <h2 className="text-lg font-semibold text-text-primary mb-4">
        Recent Payments
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Listing</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Stripe ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell>
                {payment.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className="max-w-[200px] truncate">
                {payment.listing.title}
              </TableCell>
              <TableCell>
                £{(payment.amount / 100).toFixed(2)}
              </TableCell>
              <TableCell>
                <Badge variant={PAYMENT_STATUS_VARIANT[payment.status] ?? "neutral"}>
                  {payment.status}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-text-tertiary max-w-[160px] truncate">
                {payment.stripePaymentId}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Subscriptions */}
      <h2 className="text-lg font-semibold text-text-primary mt-8 mb-4">
        Dealer Subscriptions
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Period End</TableHead>
            <TableHead>Stripe ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subscriptions.map((sub) => (
            <TableRow key={sub.id}>
              <TableCell className="font-medium">{sub.dealer.name}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    sub.status === "ACTIVE"
                      ? "success"
                      : sub.status === "PAST_DUE"
                        ? "warning"
                        : "error"
                  }
                >
                  {sub.status}
                </Badge>
              </TableCell>
              <TableCell>
                {sub.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-text-tertiary max-w-[160px] truncate">
                {sub.stripeSubscriptionId}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
