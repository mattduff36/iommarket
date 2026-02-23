export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { RefundButton } from "./payment-actions";
import { CancelSubButton } from "./subscription-actions";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Payments | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    tab?: string;
    page?: string;
  }>;
}

const PAYMENT_STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  SUCCEEDED: "success",
  PENDING: "warning",
  FAILED: "error",
  REFUNDED: "neutral",
};

const SUB_STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  ACTIVE: "success",
  PAST_DUE: "warning",
  CANCELLED: "error",
  INCOMPLETE: "neutral",
};

const PAGE_SIZE = 25;

export default async function AdminPaymentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const tab = params.tab ?? "payments";
  const query = params.q ?? "";
  const statusFilter = params.status;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { tab, q: query || undefined, status: statusFilter, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "undefined") p.set(k, v);
    }
    return `/admin/payments?${p.toString()}`;
  }

  if (tab === "subscriptions") {
    const subWhere: Prisma.SubscriptionWhereInput = {};
    if (statusFilter) subWhere.status = statusFilter as "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE";

    const [subscriptions, subTotal] = await Promise.all([
      db.subscription.findMany({
        where: subWhere,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { dealer: { select: { name: true, slug: true } } },
      }),
      db.subscription.count({ where: subWhere }),
    ]);

    const subPages = Math.ceil(subTotal / PAGE_SIZE);

    return (
      <>
        <h1 className="text-2xl font-bold text-text-primary mb-6">Payments & Subscriptions</h1>

        <div className="flex gap-2 mb-6">
          <Link href={buildUrl({ tab: "payments", page: "1" })} className="h-9 inline-flex items-center px-4 rounded-md text-sm font-medium border text-text-secondary border-transparent hover:bg-surface-elevated">
            Payments
          </Link>
          <Link href={buildUrl({ tab: "subscriptions", page: "1" })} className="h-9 inline-flex items-center px-4 rounded-md text-sm font-medium border bg-surface-elevated text-text-primary border-border">
            Subscriptions
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(["ACTIVE", "PAST_DUE", "CANCELLED", "INCOMPLETE"] as const).map((s) => (
            <Link
              key={s}
              href={buildUrl({ status: statusFilter === s ? undefined : s, page: "1" })}
              className={`h-8 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
                statusFilter === s ? "bg-surface-elevated text-text-primary border-border" : "text-text-secondary border-transparent hover:bg-surface-elevated"
              }`}
            >
              {s}
            </Link>
          ))}
          <span className="text-xs text-text-tertiary ml-auto">{subTotal} subscriptions</span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dealer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period End</TableHead>
              <TableHead>Stripe ID</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell className="font-medium text-text-primary">{sub.dealer.name}</TableCell>
                <TableCell>
                  <Badge variant={SUB_STATUS_VARIANT[sub.status] ?? "neutral"}>{sub.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {sub.currentPeriodEnd?.toLocaleDateString("en-GB") ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-text-tertiary max-w-[160px] truncate">
                  {sub.stripeSubscriptionId}
                </TableCell>
                <TableCell className="text-sm text-text-tertiary">
                  {sub.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell>
                  <CancelSubButton subscriptionId={sub.id} status={sub.status} />
                </TableCell>
              </TableRow>
            ))}
            {subscriptions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-text-tertiary py-8">No subscriptions found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {subPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            {page > 1 && <Link href={buildUrl({ page: String(page - 1) })} className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border">Previous</Link>}
            <span className="text-sm text-text-tertiary">Page {page} of {subPages}</span>
            {page < subPages && <Link href={buildUrl({ page: String(page + 1) })} className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border">Next</Link>}
          </div>
        )}
      </>
    );
  }

  // Payments tab (default)
  const payWhere: Prisma.PaymentWhereInput = {};
  if (query) {
    payWhere.OR = [
      { stripePaymentId: { contains: query } },
      { listing: { title: { contains: query, mode: "insensitive" } } },
    ];
  }
  if (statusFilter) payWhere.status = statusFilter as "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

  const [payments, payTotal] = await Promise.all([
    db.payment.findMany({
      where: payWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        listing: { select: { title: true, user: { select: { email: true } } } },
      },
    }),
    db.payment.count({ where: payWhere }),
  ]);

  const payPages = Math.ceil(payTotal / PAGE_SIZE);

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Payments & Subscriptions</h1>

      <div className="flex gap-2 mb-6">
        <Link href={buildUrl({ tab: "payments", page: "1" })} className="h-9 inline-flex items-center px-4 rounded-md text-sm font-medium border bg-surface-elevated text-text-primary border-border">
          Payments
        </Link>
        <Link href={buildUrl({ tab: "subscriptions", page: "1" })} className="h-9 inline-flex items-center px-4 rounded-md text-sm font-medium border text-text-secondary border-transparent hover:bg-surface-elevated">
          Subscriptions
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <form method="get" action="/admin/payments" className="flex gap-2">
          <input name="q" defaultValue={query} placeholder="Search Stripe ID or listing..." className="h-9 w-64 rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus" />
          <input type="hidden" name="tab" value="payments" />
          <button type="submit" className="h-9 px-3 rounded-md bg-surface-elevated text-sm font-medium text-text-primary hover:bg-surface border border-border">Search</button>
        </form>

        {(["SUCCEEDED", "PENDING", "FAILED", "REFUNDED"] as const).map((s) => (
          <Link
            key={s}
            href={buildUrl({ status: statusFilter === s ? undefined : s, page: "1" })}
            className={`h-8 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
              statusFilter === s ? "bg-surface-elevated text-text-primary border-border" : "text-text-secondary border-transparent hover:bg-surface-elevated"
            }`}
          >
            {s}
          </Link>
        ))}
        <span className="text-xs text-text-tertiary ml-auto">{payTotal} payments</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Listing</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Stripe ID</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="text-sm text-text-tertiary">
                {payment.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-sm text-text-primary">
                {payment.listing.title}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {payment.listing.user.email}
              </TableCell>
              <TableCell className="text-sm text-text-primary">
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
              <TableCell>
                <RefundButton paymentId={payment.id} status={payment.status} />
              </TableCell>
            </TableRow>
          ))}
          {payments.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-text-tertiary py-8">No payments found.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {payPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && <Link href={buildUrl({ page: String(page - 1) })} className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border">Previous</Link>}
          <span className="text-sm text-text-tertiary">Page {page} of {payPages}</span>
          {page < payPages && <Link href={buildUrl({ page: String(page + 1) })} className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border">Next</Link>}
        </div>
      )}
    </>
  );
}
