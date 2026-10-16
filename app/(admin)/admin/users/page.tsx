export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { TradeMembershipStatus } from "@prisma/client";
import Link from "@/components/navigation/link";
import { db } from "@/lib/db";
import {
  TableHeader,
  TableBody,
  TableRow,
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
import { UserAccountStatusBadge } from "@/components/admin/user-account-status-badge";
import { tradeMembershipLabel } from "@/components/admin/trade-admin-ui";
import { UserActions } from "./user-actions";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";
import { formatAdminDate } from "@/lib/admin/format";
import { buildAdminUsersWhere } from "@/lib/admin/query";
import {
  applySampleListingVisibility,
  getSampleVisibility,
} from "@/lib/listings/sample-visibility";
import { USER_TABLE_COLUMNS, USER_TABLE_SORT } from "@/lib/admin/table-columns";
import { userOrderBy } from "@/lib/admin/table-order";
import { buildAdminListHref, parseAdminSort } from "@/lib/admin/table-state";

export const metadata: Metadata = { title: "Users | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    role?: string;
    disabled?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}

const ROLE_LABEL: Record<string, string> = { USER: "User", DEALER: "Dealer", ADMIN: "Admin" };

const PAGE_SIZE = 25;

function TradeApplicationStatus({
  membership,
}: {
  membership: { id: string; status: TradeMembershipStatus } | null;
}) {
  const status = membership?.status;
  const tone = status === "APPROVED" ? "text-[#66c69b]"
    : status === "REJECTED" || status === "REVOKED" ? "text-[#ef9b9b]"
    : status === "PENDING" || status === "SUSPENDED" ? "text-[#e4be70]"
    : status === "NEEDS_INFO" ? "text-neon-blue-400" : "text-text-secondary";
  return <Link href="/admin/trade/applications" className={`${tone} hover:underline`}>
    {status ? tradeMembershipLabel(status) : "Not applied"}
  </Link>;
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q ?? "";
  const roleFilter = params.role as "USER" | "DEALER" | "ADMIN" | undefined;
  const disabledFilter = params.disabled === "true" ? true : params.disabled === "false" ? false : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const sort = parseAdminSort(params, USER_TABLE_COLUMNS, USER_TABLE_SORT);
  const now = new Date();
  const tradeEnabled = isTradeExchangeEnabled();
  const paidEntitlementWhere = getPaidSubscriptionEntitlementWhere(now);
  const sampleVisibility = await getSampleVisibility();
  const visibleListings = applySampleListingVisibility({}, sampleVisibility);

  const where = buildAdminUsersWhere({
    query,
    role: roleFilter,
    disabled: disabledFilter,
    deleted: params.disabled === "deleted",
  }, sampleVisibility);

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: userOrderBy(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        region: { select: { name: true } },
        dealerProfile: {
          select: {
            id: true,
            name: true,
            verified: true,
            tier: true,
            subscriptions: {
              where: {
                OR: [
                  paidEntitlementWhere,
                  {
                    source: "ADMIN_GRANT",
                    status: "ACTIVE",
                    revokedAt: null,
                    grantStartsAt: { lte: now },
                    grantEndsAt: { gt: now },
                  },
                ],
              },
              select: { id: true, source: true },
            },
          },
        },
        dealerUpgradeOffers: {
          where: { status: "PENDING" },
          select: { id: true },
          take: 1,
        },
        _count: { select: { listings: { where: visibleListings } } },
      },
    }),
    db.user.count({ where }),
  ]);
  const dealerIds = users.flatMap((user) => (user.dealerProfile ? [user.dealerProfile.id] : []));
  const tradeMemberships = tradeEnabled && dealerIds.length > 0
    ? await db.tradeMembership.findMany({
        where: { dealerId: { in: dealerIds } },
        select: { id: true, dealerId: true, status: true },
      })
    : [];
  const tradeByDealerId = new Map(tradeMemberships.map((membership) => [membership.dealerId, membership]));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const current = {
    q: query || undefined,
    role: roleFilter,
    disabled: params.disabled,
    page: String(page),
    sort: sort.explicit ? sort.column : undefined,
    dir: sort.explicit ? sort.direction : undefined,
  };

  function buildUrl(overrides: Record<string, string | undefined>) {
    return buildAdminListHref("/admin/users", current, overrides);
  }

  return (
    <AdminColumnVisibility tableId="users" columns={USER_TABLE_COLUMNS}>
      <AdminPageHeader
        title="Users"
        description="Manage account roles, dealer access, and account status."
      />

      <AdminFilterBar
        count={`${total} ${total === 1 ? "user" : "users"}`}
        tools={<AdminColumnMenu />}
      >
        <form method="get" action="/admin/users" className="flex min-w-0 gap-2">
          {current.sort ? <input type="hidden" name="sort" value={current.sort} /> : null}
          {current.dir ? <input type="hidden" name="dir" value={current.dir} /> : null}
          <input
            name="q"
            defaultValue={query}
            placeholder="Search email or name..."
            aria-label="Search users"
            className={adminSearchInputClass}
          />
          {roleFilter && <input type="hidden" name="role" value={roleFilter} />}
          <button
            type="submit"
            className={adminSearchButtonClass}
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-1">
          {(["USER", "DEALER", "ADMIN"] as const).map((r) => (
            <AdminFilterChip
              key={r}
              href={buildUrl({ role: roleFilter === r ? undefined : r, page: "1" })}
              active={roleFilter === r}
            >
              {ROLE_LABEL[r]}
            </AdminFilterChip>
          ))}
        </div>

        <AdminFilterChip
          href={buildUrl({
            disabled: disabledFilter === true ? undefined : "true",
            page: "1",
          })}
          active={disabledFilter === true}
          activeTone="warning"
        >
          Disabled
        </AdminFilterChip>
        <AdminFilterChip
          href={buildUrl({
            disabled: params.disabled === "deleted" ? undefined : "deleted",
            page: "1",
          })}
          active={params.disabled === "deleted"}
          activeTone="warning"
        >
          Deleted
        </AdminFilterChip>
      </AdminFilterBar>

      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            {USER_TABLE_COLUMNS.map((column) => (
              <AdminTableHeaderCell
                key={column.id}
                column={column}
                sort={sort}
                pathname="/admin/users"
                current={current}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const tradeMembership = user.dealerProfile
              ? tradeByDealerId.get(user.dealerProfile.id) ?? null
              : null;
            return (
            <TableRow key={user.id} style={user.role === "ADMIN" ? { backgroundColor: "rgba(239, 68, 68, 0.15)" } : undefined}>
              <TableCell data-column="user">
                <AdminDataCell
                  title={
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="block max-w-56 truncate hover:text-neon-blue-400 hover:underline"
                    >
                      {user.name ?? "Unnamed user"}
                    </Link>
                  }
                  subtitle={<>
                    {user.dealerProfile ? <div className="flex flex-wrap items-baseline gap-x-1">
                      <Link href={`/admin/dealers?id=${user.dealerProfile.id}`} className="text-neon-blue-400 hover:underline break-words">
                        {user.dealerProfile.name}
                      </Link>
                      {user.region?.name ? <span>· {user.region.name}</span> : null}
                    </div> : user.region?.name ? <div>{user.region.name}</div> : null}
                    <span className="block break-all">{user.email}</span>
                  </>}
                  badges={
                    <UserAccountStatusBadge
                      deletedAt={user.deletedAt}
                      disabledAt={user.disabledAt}
                    />
                  }
                />
              </TableCell>
              <TableCell data-column="access">
                <div className="flex flex-wrap gap-1.5">
                  {user.role === "ADMIN" ? <span className="inline-flex rounded border border-white bg-transparent px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">ADMIN</span> : null}
                  {user.dealerProfile ? <span className="inline-flex rounded border border-[#d88b8b]/[.28] bg-[#d88b8b]/[.08] px-2 py-0.5 text-[11px] font-semibold text-[#d88b8b]">
                    {user.dealerProfile.tier === "PRO" ? "Dealer Pro" : "Dealer Starter"}
                  </span> : user.role !== "ADMIN" ? <span className={user.role === "DEALER"
                    ? "inline-flex rounded border border-[#d88b8b]/[.28] bg-[#d88b8b]/[.08] px-2 py-0.5 text-[11px] font-semibold text-[#d88b8b]"
                    : "inline-flex rounded border border-[#284361] bg-[#101c2c] px-2 py-0.5 text-[11px] font-semibold text-[#8cc1ff]"}>
                    {user.role === "DEALER" ? "Dealer" : "User"}
                  </span> : null}
                </div>
                {user.dealerProfile?.subscriptions.some((subscription) => subscription.source === "PAYMENT") ? (
                  <div className="mt-1.5 text-xs text-text-secondary">Paid</div>
                ) : user.dealerProfile?.subscriptions.some((subscription) => subscription.source === "ADMIN_GRANT") ? (
                  <div className="mt-1.5 text-xs text-text-secondary">Free grant</div>
                ) : null}
                {user.dealerUpgradeOffers.length > 0 ? <div className="mt-2 text-xs text-[#e4be70]">Dealer offer pending</div> : null}
              </TableCell>
              <TableCell data-column="details">
                {user.dealerProfile ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-text-secondary">Public</dt>
                  <dd className={user.dealerProfile.verified ? "text-[#66c69b]" : "text-text-secondary"}>
                    {user.dealerProfile.verified ? "Verified" : "Unverified"}
                  </dd>
                  {tradeEnabled ? <><dt className="text-text-secondary">Trade</dt><dd><TradeApplicationStatus membership={tradeMembership} /></dd></> : null}
                </dl> : <span className="text-text-secondary" aria-label="No additional details">—</span>}
              </TableCell>
              <TableCell data-column="region">{user.region?.name ?? "Not assigned"}</TableCell>
              <TableCell data-column="dealer">{user.dealerProfile?.name ?? "\u2014"}</TableCell>
              <TableCell data-column="listings" className={adminNumericCellClass}>
                {user._count.listings}
              </TableCell>
              <TableCell data-column="joined" className={adminDateCellClass}>
                {formatAdminDate(user.createdAt)}
              </TableCell>
              <TableCell data-column="phone" className="text-sm text-text-secondary">
                {user.phone ?? "—"}
              </TableCell>
              <TableCell data-column="updated" className={adminDateCellClass}>
                {formatAdminDate(user.updatedAt)}
              </TableCell>
              <TableCell data-column="actions" className={adminActionsCellClass}>
                <UserActions
                  variant="row"
                  userId={user.id}
                  currentRole={user.role}
                  isDisabled={!!user.disabledAt}
                  isDeleted={!!user.deletedAt}
                  userLabel={user.name ?? user.email}
                  hasActiveAdminGrant={
                    user.dealerProfile?.subscriptions.some(
                      (subscription) => subscription.source === "ADMIN_GRANT",
                    ) ?? false
                  }
                  pendingDealerUpgradeOfferId={
                    user.dealerUpgradeOffers[0]?.id ?? null
                  }
                  currentTier={user.dealerProfile?.tier ?? null}
                  hasActivePaidSubscription={
                    user.dealerProfile?.subscriptions.some(
                      (subscription) => subscription.source === "PAYMENT",
                    ) ?? false
                  }
                  tradeMembershipId={tradeEnabled ? tradeMembership?.id ?? null : null}
                />
              </TableCell>
            </TableRow>
            );
          })}
          {users.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={USER_TABLE_COLUMNS.length}>
                No users match these filters.
              </AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>

      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => buildUrl({ page: String(nextPage) })}
      />
    </AdminColumnVisibility>
  );
}
