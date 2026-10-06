export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import { AdminRecordLink } from "@/components/admin/admin-record-link";
import {
  AdminFilterBar,
  AdminFilterChip,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { dealerAdminHref, listingReviewHref } from "@/lib/admin/record-href";
import { AdminColumnMenu, AdminColumnVisibility } from "@/components/admin/admin-column-visibility";
import { AdminPager } from "@/components/admin/admin-pager";
import { AdminTableHeaderCell } from "@/components/admin/admin-sortable-head";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import {
  ReconcileRippleButton,
  RefundButton,
} from "./payment-actions";
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
import { getDealerPackageLabel } from "@/lib/config/dealer-tiers";
import { formatAdminDate, formatAdminPounds } from "@/lib/admin/format";
import {
  PAYMENT_TABLE_COLUMNS,
  PAYMENT_TABLE_SORT,
  SUBSCRIPTION_TABLE_COLUMNS,
  SUBSCRIPTION_TABLE_SORT,
} from "@/lib/admin/table-columns";
import {
  PAYMENT_STATUS_FILTERS,
  PAYMENT_TYPE_FILTERS,
  SUBSCRIPTION_STATUS_FILTERS,
  adminPaymentTabHref,
  parsePaymentStatus,
  parsePaymentType,
  parseSubscriptionStatus,
} from "@/lib/admin/payment-filters";
import { paymentOrderBy, subscriptionOrderBy } from "@/lib/admin/table-order";
import { buildAdminListHref, parseAdminSort } from "@/lib/admin/table-state";
import type { Prisma } from "@prisma/client";
import { getSampleVisibility } from "@/lib/listings/sample-visibility";
import {
  resolveManualReviewAttemptWhere,
  resolveVisibleAdminPaymentWhere,
} from "@/lib/payments/payment-visibility";
import {
  applySamplePaymentVisibility,
  applySampleSubscriptionVisibility,
} from "@/lib/listings/sample-related-visibility";

export const metadata: Metadata = { title: "Payments | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
    tab?: string;
    page?: string;
    sort?: string;
    dir?: string;
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
      <AdminFilterChip
        href={hrefForTab("reconciliation")}
        active={activeTab === "reconciliation"}
        activeTone="warning"
      >
        Needs reconciliation
      </AdminFilterChip>
    </AdminFilterBar>
  );
}

export default async function AdminPaymentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const sampleVisibility = await getSampleVisibility();
  const capabilities = getPaymentProviderCapabilities();
  const providerPortalUrl = getPaymentProviderPortalUrl();
  const tab = params.tab ?? "payments";
  const query = params.q ?? "";
  const paymentStatus = parsePaymentStatus(params.status);
  const subscriptionStatus = parseSubscriptionStatus(params.status);
  const typeFilter = tab === "payments" ? parsePaymentType(params.type) : undefined;
  const statusFilter = tab === "subscriptions"
    ? subscriptionStatus
    : tab === "payments"
      ? paymentStatus
      : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const sort = tab === "subscriptions"
    ? parseAdminSort(params, SUBSCRIPTION_TABLE_COLUMNS, SUBSCRIPTION_TABLE_SORT)
    : parseAdminSort(params, PAYMENT_TABLE_COLUMNS, PAYMENT_TABLE_SORT);

  const listParams = {
    tab,
    q: query || undefined,
    status: statusFilter,
    type: typeFilter,
    page: String(page),
    sort: sort.explicit ? sort.column : undefined,
    dir: sort.explicit ? sort.direction : undefined,
  };

  function buildUrl(overrides: Record<string, string | undefined>) {
    return buildAdminListHref("/admin/payments", listParams, overrides);
  }

  const hrefForTab = (nextTab: string) => adminPaymentTabHref(listParams, nextTab);

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
        customerEmailNorm: true,
        currency: true,
        status: true,
      },
    });

    return (
      <>
        <AdminPageHeader
          title="Payments & subscriptions"
          description="Review charges, recurring billing, refunds, and unmatched provider events."
        />
        <PaymentTabs activeTab={tab} hrefForTab={hrefForTab} />
        <UnmatchedInboxTab rows={unmatched} />
      </>
    );
  }

  if (tab === "reconciliation") {
    const attempts = await db.paymentCheckoutAttempt.findMany({
      where: await resolveManualReviewAttemptWhere(),
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: {
        payment: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                featured: true,
                user: { select: { email: true } },
              },
            },
          },
        },
        observations: {
          orderBy: { observedAt: "desc" },
          take: 2,
        },
      },
    });
    const merchantReferences = attempts.map(
      (attempt) => attempt.merchantReference,
    );
    const inboxRows = merchantReferences.length
      ? await db.paymentWebhookInbox.findMany({
          where: { merchantReference: { in: merchantReferences } },
          select: { merchantReference: true, status: true },
        })
      : [];
    const inboxStatus = new Map(
      inboxRows.map((row) => [row.merchantReference, row.status]),
    );

    return (
      <>
        <AdminPageHeader
          title="Payments & subscriptions"
          description="Review checkouts that have provider evidence and still need a verified outcome."
          meta={
            <span>
              Generated {new Date().toLocaleString("en-GB")} ·{" "}
              <Link href="/admin/payments?tab=reconciliation">Refresh</Link>
            </span>
          }
        />
        <PaymentTabs activeTab={tab} hrefForTab={hrefForTab} />
        <AdminTable minWidth="wide">
          <TableHeader>
            <TableRow>
              <TableHead>Opened</TableHead>
              <TableHead>Listing / product</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Merchant reference</TableHead>
              <TableHead>Observed provider reference</TableHead>
              <TableHead>Inbox</TableHead>
              <TableHead>Entitlement</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map((attempt) => (
              <TableRow key={attempt.id}>
                <TableCell className={adminDateCellClass}>
                  {formatAdminDate(attempt.createdAt)}
                </TableCell>
                <TableCell>
                  <AdminDataCell
                    title={
                      attempt.payment?.listing ? (
                        <AdminRecordLink
                          href={listingReviewHref(attempt.payment.listing.id)}
                          external
                          className="block max-w-[200px] truncate"
                        >
                          {attempt.payment.listing.title}
                        </AdminRecordLink>
                      ) : (
                        attempt.productCode
                      )
                    }
                    subtitle={attempt.payment?.listing.user.email}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="warning">{attempt.status}</Badge>
                </TableCell>
                <TableCell className={adminNumericCellClass}>
                  {formatAdminPounds(attempt.amountPence, 2)}
                </TableCell>
                <TableCell className="max-w-40 truncate font-mono text-xs text-text-tertiary">
                  {attempt.merchantReference}
                </TableCell>
                <TableCell className="max-w-40 truncate font-mono text-xs text-text-tertiary">
                  {attempt.observations[0]?.providerPaymentId ?? "None"}
                </TableCell>
                <TableCell className="text-xs text-text-secondary">
                  {inboxStatus.get(attempt.merchantReference) ?? "No receipt"}
                </TableCell>
                <TableCell className="text-xs text-text-secondary">
                  {attempt.payment?.featuredAppliedAt
                    ? "Applied"
                    : attempt.payment?.listing.featured
                      ? "Featured by another source"
                      : "Not applied"}
                </TableCell>
                <TableCell className={adminActionsCellClass}>
                  {attempt.payment?.status === "PENDING" &&
                  attempt.payment.paymentProvider === "RIPPLE" &&
                  attempt.payment.type === "FEATURED" ? (
                    <ReconcileRippleButton paymentId={attempt.payment.id} />
                  ) : (
                    <span className="text-xs text-text-tertiary">
                      Review only
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {attempts.length === 0 ? (
              <TableRow>
                <AdminTableEmpty colSpan={9}>
                  No checkout attempts need reconciliation.
                </AdminTableEmpty>
              </TableRow>
            ) : null}
          </TableBody>
        </AdminTable>
      </>
    );
  }

  if (tab === "subscriptions") {
    const subWhere: Prisma.SubscriptionWhereInput = {};
    if (subscriptionStatus) subWhere.status = subscriptionStatus;
    const visibleSubWhere = applySampleSubscriptionVisibility(
      subWhere,
      sampleVisibility,
    );

    const [subscriptions, subTotal] = await Promise.all([
      db.subscription.findMany({
        where: visibleSubWhere,
        orderBy: subscriptionOrderBy(sort),
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          dealer: { select: { id: true, name: true, slug: true, tier: true } },
          charges: {
            where: { refundedAt: null },
            orderBy: { eventTimestamp: "desc" },
            take: 1,
            select: { id: true, amount: true, currency: true, paymentReference: true },
          },
        },
      }),
      db.subscription.count({ where: visibleSubWhere }),
    ]);

    const subPages = Math.ceil(subTotal / PAGE_SIZE);

    return (
      <>
        <AdminPageHeader
          title="Payments & subscriptions"
          description="Review charges, recurring billing, refunds, and unmatched provider events."
        />
        <PaymentTabs activeTab={tab} hrefForTab={hrefForTab} />

        <AdminColumnVisibility tableId="subscriptions" columns={SUBSCRIPTION_TABLE_COLUMNS}>
        <AdminFilterBar
          count={`${subTotal} subscriptions`}
          tools={<AdminColumnMenu />}
        >
          {SUBSCRIPTION_STATUS_FILTERS.map((s) => (
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
              Refund the charge in Ripple&apos;s portal, then record it here. Recording updates local access and does not send a refund to Ripple.
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
              {SUBSCRIPTION_TABLE_COLUMNS.map((column) => (
                <AdminTableHeaderCell
                  key={column.id}
                  column={column}
                  sort={sort}
                  pathname="/admin/payments"
                  current={listParams}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell data-column="dealer">
                  <AdminDataCell
                    title={
                      <AdminRecordLink href={dealerAdminHref(sub.dealer.id)}>
                        {sub.dealer.name}
                      </AdminRecordLink>
                    }
                    subtitle={sub.dealer.slug}
                  />
                </TableCell>
                <TableCell data-column="status">
                  <Badge variant={SUB_STATUS_VARIANT[sub.status] ?? "neutral"}>{sub.status}</Badge>
                </TableCell>
                <TableCell data-column="period" className={adminDateCellClass}>
                  {formatAdminDate(sub.source === "ADMIN_GRANT"
                    ? sub.grantEndsAt
                    : sub.currentPeriodEnd)}
                </TableCell>
                <TableCell data-column="source" className="text-xs text-text-tertiary">
                  {sub.source === "ADMIN_GRANT" ? "Free admin grant" : "Paid"}
                </TableCell>
                <TableCell data-column="reference" className="max-w-[160px] truncate font-mono text-xs text-text-tertiary">
                  {getSubscriptionDisplayId(sub)}
                </TableCell>
                <TableCell data-column="provider" className="text-xs text-text-tertiary">
                  {getProviderLabel(sub.paymentProvider)}
                </TableCell>
                <TableCell data-column="created" className={adminDateCellClass}>
                  {formatAdminDate(sub.createdAt)}
                </TableCell>
                <TableCell data-column="tier">
                  <Badge variant={sub.dealer.tier === "PRO" ? "info" : "neutral"}>
                    {getDealerPackageLabel(sub.dealer.tier)}
                  </Badge>
                </TableCell>
                <TableCell data-column="cancel" className="text-sm text-text-secondary">
                  {sub.cancelAtPeriodEnd ? "Yes" : "No"}
                </TableCell>
                <TableCell data-column="actions" className={adminActionsCellClass}>
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
                        charge={sub.charges[0] ?? null}
                        recordLocally={!capabilities.supportsInAppRefunds}
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
                <AdminTableEmpty colSpan={SUBSCRIPTION_TABLE_COLUMNS.length}>
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
        </AdminColumnVisibility>
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
  if (paymentStatus) payWhere.status = paymentStatus;
  if (typeFilter) payWhere.type = typeFilter;
  const visiblePayWhere = await resolveVisibleAdminPaymentWhere(
    applySamplePaymentVisibility(payWhere, sampleVisibility),
  );

  const [payments, payTotal] = await Promise.all([
    db.payment.findMany({
      where: visiblePayWhere,
      orderBy: paymentOrderBy(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        listing: { select: { id: true, title: true, user: { select: { email: true } } } },
        checkoutAttempt: {
          select: {
            status: true,
            returnedAt: true,
            alertedAt: true,
          },
        },
      },
    }),
    db.payment.count({ where: visiblePayWhere }),
  ]);

  const payPages = Math.ceil(payTotal / PAGE_SIZE);

  return (
    <>
      <AdminPageHeader
        title="Payments & subscriptions"
        description="Review charges, recurring billing, refunds, and unmatched provider events."
      />
      <PaymentTabs activeTab={tab} hrefForTab={hrefForTab} />

      <AdminColumnVisibility tableId="payments" columns={PAYMENT_TABLE_COLUMNS}>
      <AdminFilterBar
        count={`${payTotal} payments`}
        tools={<AdminColumnMenu />}
      >
        <form method="get" action="/admin/payments" className="flex min-w-0 gap-2">
          {sort.explicit ? <input type="hidden" name="sort" value={sort.column} /> : null}
          {sort.explicit ? <input type="hidden" name="dir" value={sort.direction} /> : null}
          {paymentStatus ? <input type="hidden" name="status" value={paymentStatus} /> : null}
          {typeFilter ? <input type="hidden" name="type" value={typeFilter} /> : null}
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

        {PAYMENT_STATUS_FILTERS.map((s) => (
          <AdminFilterChip
            key={s}
            href={buildUrl({ status: statusFilter === s ? undefined : s, page: "1" })}
            active={statusFilter === s}
          >
            {s}
          </AdminFilterChip>
        ))}
        {PAYMENT_TYPE_FILTERS.map((t) => (
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
            {PAYMENT_TABLE_COLUMNS.map((column) => (
              <AdminTableHeaderCell
                key={column.id}
                column={column}
                sort={sort}
                pathname="/admin/payments"
                current={listParams}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell data-column="date" className={adminDateCellClass}>
                {formatAdminDate(payment.createdAt)}
              </TableCell>
              <TableCell data-column="listing">
                <AdminDataCell
                  title={
                    <AdminRecordLink
                      href={listingReviewHref(payment.listing.id)}
                      external
                      className="block max-w-[200px] truncate"
                    >
                      {payment.listing.title}
                    </AdminRecordLink>
                  }
                  subtitle={payment.listing.user.email}
                />
              </TableCell>
              <TableCell data-column="type" className="text-sm text-text-secondary">{payment.type}</TableCell>
              <TableCell data-column="amount" className={adminNumericCellClass}>
                {formatAdminPounds(payment.amount, 2)}
              </TableCell>
              <TableCell data-column="status">
                <Badge variant={PAYMENT_STATUS_VARIANT[payment.status] ?? "neutral"}>
                  {payment.status}
                </Badge>
                {payment.checkoutAttempt ? (
                  <span className="mt-1 block text-[11px] text-text-tertiary">
                    Reconciliation: {payment.checkoutAttempt.status}
                  </span>
                ) : null}
              </TableCell>
              <TableCell data-column="reference" className="max-w-[160px] truncate font-mono text-xs text-text-tertiary">
                {getPaymentDisplayId(payment)}
              </TableCell>
              <TableCell data-column="provider" className="text-xs text-text-tertiary">
                {getProviderLabel(payment.paymentProvider)}
              </TableCell>
              <TableCell data-column="currency" className="text-xs uppercase text-text-tertiary">
                {payment.currency}
              </TableCell>
              <TableCell data-column="refunded" className={adminDateCellClass}>
                {formatAdminDate(payment.refundedAt)}
              </TableCell>
              <TableCell data-column="actions" className={adminActionsCellClass}>
                <div className="flex flex-wrap items-start gap-1">
                  <RefundButton
                    paymentId={payment.id}
                    status={payment.status}
                    enabled={capabilities.supportsInAppRefunds}
                    providerPortalUrl={providerPortalUrl}
                  />
                  {payment.status === "PENDING" &&
                  payment.paymentProvider === "RIPPLE" &&
                  payment.type === "FEATURED" &&
                  payment.checkoutAttempt ? (
                    <ReconcileRippleButton paymentId={payment.id} />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {payments.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={PAYMENT_TABLE_COLUMNS.length}>
                No payments match these filters.
              </AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>

      <AdminPager
        page={page}
        totalPages={payPages}
        hrefForPage={(nextPage) => buildUrl({ page: String(nextPage) })}
      />
      </AdminColumnVisibility>
    </>
  );
}
