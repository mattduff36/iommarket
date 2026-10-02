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
import { UserActions } from "./user-actions";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";
import { getDealerPackageLabel } from "@/lib/config/dealer-tiers";
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

const ROLE_BADGE: Record<string, "neutral" | "info" | "warning" | "error"> = {
  USER: "neutral",
  DEALER: "info",
  ADMIN: "error",
};

const ROLE_LABEL: Record<string, string> = {
  USER: "User",
  DEALER: "Dealer",
  ADMIN: "Admin",
};

const PAGE_SIZE = 25;

export default async function AdminUsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q ?? "";
  const roleFilter = params.role as "USER" | "DEALER" | "ADMIN" | undefined;
  const disabledFilter = params.disabled === "true" ? true : params.disabled === "false" ? false : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const sort = parseAdminSort(params, USER_TABLE_COLUMNS, USER_TABLE_SORT);
  const now = new Date();
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
          {users.map((user) => (
            <TableRow key={user.id}>
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
                  subtitle={<span className="block max-w-56 truncate">{user.email}</span>}
                  badges={
                    <UserAccountStatusBadge
                      deletedAt={user.deletedAt}
                      disabledAt={user.disabledAt}
                    />
                  }
                />
              </TableCell>
              <TableCell data-column="access">
                <div className="flex max-w-48 flex-wrap gap-1.5">
                  <Badge variant={ROLE_BADGE[user.role] ?? "neutral"}>
                    {ROLE_LABEL[user.role] ?? user.role}
                  </Badge>
                  {user.dealerProfile ? (
                    <Badge variant={user.dealerProfile.tier === "PRO" ? "info" : "neutral"}>
                      {getDealerPackageLabel(user.dealerProfile.tier)}
                    </Badge>
                  ) : null}
                  {user.dealerProfile?.subscriptions.some(
                    (subscription) => subscription.source === "PAYMENT",
                  ) ? (
                    <Badge variant="success">Paid</Badge>
                  ) : user.dealerProfile?.subscriptions.some(
                      (subscription) => subscription.source === "ADMIN_GRANT",
                    ) ? (
                    <Badge variant="warning">Free grant</Badge>
                  ) : null}
                  {user.dealerUpgradeOffers.length > 0 ? (
                    <Badge variant="warning">Dealer offer pending</Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell data-column="region" className="text-sm text-text-secondary">
                {user.region?.name ?? (
                  <span className="text-text-tertiary">Not assigned</span>
                )}
              </TableCell>
              <TableCell data-column="dealer">
                {user.dealerProfile ? (
                  <AdminDataCell
                    title={
                      <Link
                        href={`/admin/dealers?id=${user.dealerProfile.id}`}
                        className="block max-w-44 truncate text-neon-blue-400 hover:underline"
                      >
                        {user.dealerProfile.name}
                      </Link>
                    }
                    badges={
                      <Badge variant={user.dealerProfile.verified ? "success" : "neutral"}>
                        {user.dealerProfile.verified ? "Verified" : "Unverified"}
                      </Badge>
                    }
                  />
                ) : (
                  <span className="text-sm text-text-tertiary">Not a dealer</span>
                )}
              </TableCell>
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
                />
              </TableCell>
            </TableRow>
          ))}
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
