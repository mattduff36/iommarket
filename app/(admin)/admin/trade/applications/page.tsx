import { ClipboardList } from "lucide-react";
import { notFound } from "next/navigation";
import type { TradeMembershipStatus } from "@prisma/client";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminFilterBar, AdminFilterChip } from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPager } from "@/components/admin/admin-pager";
import { AdminRecordLink } from "@/components/admin/admin-record-link";
import {
  TRADE_MEMBERSHIP_FILTERS,
  TradeBackLink,
  TradeMembershipBadge,
  tradeMembershipLabel,
} from "@/components/admin/trade-admin-ui";
import { Badge } from "@/components/ui/badge";
import { adminTotalPages, parseAdminPage } from "@/lib/admin/query";
import { formatAdminDate } from "@/lib/admin/format";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function parseStatus(value?: string): TradeMembershipStatus | null {
  return TRADE_MEMBERSHIP_FILTERS.find((status) => status === value) ?? null;
}

function applicationsHref(status: TradeMembershipStatus | null, page = 1) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/trade/applications?${query}` : "/admin/trade/applications";
}

export default async function AdminTradeApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  if (!isTradeExchangeEnabled()) notFound();
  const params = await searchParams;
  const status = parseStatus(params.status);
  const page = parseAdminPage(params.page);
  const where = status ? { status } : {};
  const [total, applications] = await Promise.all([
    db.tradeMembership.count({ where }),
    db.tradeMembership.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        status: true,
        businessName: true,
        duplicateRegistration: true,
        submittedAt: true,
      },
    }),
  ]);
  const totalPages = adminTotalPages(total, PAGE_SIZE);

  return (
    <section>
      <AdminPageHeader
        title="Trade applications"
        description="Business verification is separate from the public dealer badge and the subscription."
        actions={<TradeBackLink href="/admin/trade">Trade Exchange</TradeBackLink>}
      />
      <AdminFilterBar
        label="Application status"
        count={`${total.toLocaleString("en-GB")} ${total === 1 ? "application" : "applications"}`}
      >
        <AdminFilterChip href={applicationsHref(null)} active={status === null}>All</AdminFilterChip>
        {TRADE_MEMBERSHIP_FILTERS.map((filter) => (
          <AdminFilterChip
            key={filter}
            href={applicationsHref(filter)}
            active={status === filter}
            activeTone={filter === "PENDING" || filter === "NEEDS_INFO" ? "warning" : filter === "APPROVED" ? "success" : "neutral"}
          >
            {tradeMembershipLabel(filter)}
          </AdminFilterChip>
        ))}
      </AdminFilterBar>
      {applications.length === 0 ? (
        <AdminEmptyState
          icon={ClipboardList}
          title={status ? "No applications in this status" : "No applications"}
          description={status ? "Choose another status or return to the full list." : "New dealer applications will appear here."}
          action={status ? <TradeBackLink href="/admin/trade/applications">Show all applications</TradeBackLink> : undefined}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {applications.map((application) => (
            <li key={application.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <AdminRecordLink href={`/admin/trade/applications/${application.id}`} className="font-medium">
                  {application.businessName}
                </AdminRecordLink>
                <p className="mt-1 text-sm text-text-secondary">
                  Submitted <time dateTime={application.submittedAt.toISOString()}>{formatAdminDate(application.submittedAt)}</time>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {application.duplicateRegistration ? <Badge variant="warning">Duplicate registration</Badge> : null}
                <TradeMembershipBadge status={application.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <AdminPager page={page} totalPages={totalPages} hrefForPage={(nextPage) => applicationsHref(status, nextPage)} />
    </section>
  );
}
