export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import {
  AdminFilterBar,
  AdminFilterChip,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { RefundButton } from "./payment-actions";
import { CancelSubButton, RefundSubPaymentButton } from "./subscription-actions";
import { UnmatchedInboxTab } from "./unmatched-inbox-tab";
import {
  getPaymentProviderCapabilities,
  getPaymentProviderPortalUrl,
} from "@/lib/payments/provider";
import {
  getPaymentDisplayId,
  getProviderLabel,
  getSubscriptionDisplayId,
} from "@/lib/payments/records";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Payments | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
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

function PaymentTabs({
  activeTab,
  hrefForTab,
}: {
  activeTab: string;
  hrefForTab: (tab: string) => string;
}) {
  return (
    <AdminFilterBar label="Payment views">
      <AdminFilterChip href={hrefForTab("payments")} active={activeTab === "payments"}>
        Payments
      </AdminFilterChip>
      <AdminFilterChip href={hrefForTab("subscriptions")} active={activeTab === "subscriptions"}>
        Subscriptions
      </AdminFilterChip>
      <AdminFilterChip href={hrefForTab("unmatched")} active={activeTab === "unmatched"} activeTone="warning">
        Unmatched inbox
      </AdminFilterChip>
    </AdminFilterBar>
  );
}

export default async function AdminPaymentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const capabilities = getPaymentProviderCapabilities();
  const providerPortalUrl = getPaymentProviderPortalUrl();
  const tab = params.tab ?? "payments";
  const query = params.q ?? "";
  const statusFilter = params.status;
  const typeFilter = params.type;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = {
      tab,
      q: query || undefined,
      status: statusFilter,
      type: typeFilter,
      page: String(page),
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "undefined") p.set(k, v);
    }
    return `/admin/payments?${p.toString()}`;
  }

  if (tab === "unmatched") {
    const unmatched = await db.paymentWebhookInbox.findMany({
      where: {
        status: { in: ["FAILED", "QUARANTINED"] },
        lastErrorCode: { in: ["MISSING_REFERENCE", "INVALID_REFERENCE"] },
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        eventType: true,
        linkCode: true,
        packageName: true,
        amountPence: true,
        lastErrorCode: true,
        paymentReference: true,
      },
    });

    return (
      <>
        <AdminPageHeader
          title="Payments & subscriptions"
          description="Review charges, recurring billing, refunds, and unmatched provider events."
        />
        <PaymentTabs
          activeTab={tab}
          hrefForTab={(nextTab) => buildUrl({ tab: nextTab, page: "1" })}
        />
        <UnmatchedInboxTab rows={unmatched} />
      </>
    );
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
        <AdminPageHeader
          title="Payments & subscriptions"
          description="Review charges, recurring billing, refunds, and unmatched provider events."
        />
        <PaymentTabs
          activeTab={tab}
          hrefForTab={(nextTab) => buildUrl({ tab: nextTab, page: "1" })}
        />

        <AdminFilterBar count={`${subTotal} subscriptions`}>
          {(["ACTIVE", "PAST_DUE", "CANCELLED", "INCOMPLETE"] as const).map((s) => (
            <AdminFilterChip
              key={s}
              href={buildUrl({ status: statusFilter === s ? undefined : s, page: "1" })}
              active={statusFilter === s}
            >
              {s}
            </AdminFilterChip>
          ))}
        </AdminFilterBar>

        <div className="mb-4 rounded-md border border-border bg-surface-elevated px-4 py-3 text-xs text-text-secondary">
          {capabilities.supportsInAppSubscriptionCancellation ? (
            <>
              Use <span className="font-medium text-text-primary">Refund latest payment</span> to
              refund the most recent paid invoice for a subscription. Use
              <span className="font-medium text-text-primary"> Cancel</span> to stop future billing.
            </>
          ) : (
            <>
              Subscription billing actions are managed in Ripple&apos;s portal.
              {providerPortalUrl ? (
                <>
                  {" "}
                  Open{" "}
                  <a
                    href={providerPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-text-primary underline"
                  >
                    Ripple portal
                  </a>{" "}
                  for refunds and cancellations. Customer-facing rules are in the{" "}
                  <Link href="/refunds" className="font-medium text-text-primary underline">
                    Refund Policy
                  </Link>
                  . Dealer cancellation requests are in{" "}
                  <Link href="/admin/cancellations" className="font-medium text-text-primary underline">
                    Cancellations
                  </Link>
                  .
                </>
              ) : null}
            </>
          )}
        </div>

        <AdminTable minWidth="wide">
          <TableHeader>
            <TableRow>
              <TableHead>Dealer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period End</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Provider Ref</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className={adminActionsCellClass}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell>
                  <AdminDataCell title={sub.dealer.name} subtitle={sub.dealer.slug} />
                </TableCell>
                <TableCell>
                  <Badge variant={SUB_STATUS_VARIANT[sub.status] ?? "neutral"}>{sub.status}</Badge>
                </TableCell>
                <TableCell className={adminDateCellClass}>
                  {(sub.source === "ADMIN_GRANT"
                    ? sub.grantEndsAt
                    : sub.currentPeriodEnd
                  )?.toLocaleDateString("en-GB") ?? "-"}
                </TableCell>
                <TableCell className="text-xs text-text-tertiary">
                  {sub.source === "ADMIN_GRANT" ? "Free admin grant" : "Paid"}
                </TableCell>
                <TableCell className="font-mono text-xs text-text-tertiary max-w-[160px] truncate">
                  {getSubscriptionDisplayId(sub)}
              </TableCell>
              <TableCell className="text-xs text-text-tertiary">
                {getProviderLabel(sub.paymentProvider)}
                </TableCell>
                <TableCell className={adminDateCellClass}>
                  {sub.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell className={adminActionsCellClass}>
                  {sub.source === "PAYMENT" ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <CancelSubButton
                        subscriptionId={sub.id}
                        status={sub.status}
                        enabled={capabilities.supportsInAppSubscriptionCancellation}
                        providerPortalUrl={providerPortalUrl}
                      />
                      <RefundSubPaymentButton
                        subscriptionId={sub.id}
                        enabled={capabilities.supportsInAppRefunds}
                        providerPortalUrl={providerPortalUrl}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-text-tertiary">Manage in Dealers</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {subscriptions.length === 0 && (
              <TableRow>
                <AdminTableEmpty colSpan={8}>
                  No subscriptions match this filter.
                </AdminTableEmpty>
              </TableRow>
            )}
          </TableBody>
        </AdminTable>

        <AdminPager
          page={page}
          totalPages={subPages}
          hrefForPage={(nextPage) => buildUrl({ page: String(nextPage) })}
        />
      </>
    );
  }

  // Payments tab (default)
  const payWhere: Prisma.PaymentWhereInput = {};
  if (query) {
    payWhere.OR = [
      { providerPaymentId: { contains: query } },
      { providerReference: { contains: query } },
      { stripePaymentId: { contains: query } },
      { listing: { title: { contains: query, mode: "insensitive" } } },
      { listing: { user: { email: { contains: query, mode: "insensitive" } } } },
    ];
  }
  if (statusFilter) payWhere.status = statusFilter as "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
  if (typeFilter) payWhere.type = typeFilter as "LISTING" | "FEATURED" | "SUPPORT";

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
      <AdminPageHeader
        title="Payments & subscriptions"
        description="Review charges, recurring billing, refunds, and unmatched provider events."
      />
      <PaymentTabs
        activeTab={tab}
        hrefForTab={(nextTab) => buildUrl({ tab: nextTab, page: "1" })}
      />

      <AdminFilterBar count={`${payTotal} payments`}>
        <form method="get" action="/admin/payments" className="flex min-w-0 gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search provider ID, listing, or email..."
            aria-label="Search payments"
            className={adminSearchInputClass}
          />
          <input type="hidden" name="tab" value="payments" />
          <button type="submit" className={adminSearchButtonClass}>Search</button>
        </form>

        {(["SUCCEEDED", "PENDING", "FAILED", "REFUNDED"] as const).map((s) => (
          <AdminFilterChip
            key={s}
            href={buildUrl({ status: statusFilter === s ? undefined : s, page: "1" })}
            active={statusFilter === s}
          >
            {s}
          </AdminFilterChip>
        ))}
        {(["LISTING", "FEATURED", "SUPPORT"] as const).map((t) => (
          <AdminFilterChip
            key={t}
            href={buildUrl({ type: typeFilter === t ? undefined : t, page: "1" })}
            active={typeFilter === t}
          >
            {t}
          </AdminFilterChip>
        ))}
      </AdminFilterBar>

      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Listing</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Provider Ref</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead className={adminActionsCellClass}>Actions</TableHead>
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
                  title={<span className="block max-w-[200px] truncate">{payment.listing.title}</span>}
                  subtitle={payment.listing.user.email}
                />
              </TableCell>
              <TableCell className="text-sm text-text-secondary">{payment.type}</TableCell>
              <TableCell className={adminNumericCellClass}>
                £{(payment.amount / 100).toFixed(2)}
              </TableCell>
              <TableCell>
                <Badge variant={PAYMENT_STATUS_VARIANT[payment.status] ?? "neutral"}>
                  {payment.status}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-text-tertiary max-w-[160px] truncate">
                {getPaymentDisplayId(payment)}
              </TableCell>
              <TableCell className="text-xs text-text-tertiary">
                {getProviderLabel(payment.paymentProvider)}
              </TableCell>
              <TableCell className={adminActionsCellClass}>
                <RefundButton
                  paymentId={payment.id}
                  status={payment.status}
                  enabled={capabilities.supportsInAppRefunds}
                  providerPortalUrl={providerPortalUrl}
                />
              </TableCell>
            </TableRow>
          ))}
          {payments.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={8}>No payments match these filters.</AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>

      <AdminPager
        page={page}
        totalPages={payPages}
        hrefForPage={(nextPage) => buildUrl({ page: String(nextPage) })}
      />
    </>
  );
}
