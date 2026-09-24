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
import { UserAccountStatusBadge } from "@/components/admin/user-account-status-badge";
import { UserActions } from "./user-actions";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";
import { getDealerPackageLabel } from "@/lib/config/dealer-tiers";
import { buildAdminUsersWhere } from "@/lib/admin/query";

export const metadata: Metadata = { title: "Users | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    role?: string;
    disabled?: string;
    page?: string;
  }>;
}

const ROLE_BADGE: Record<string, "neutral" | "info" | "warning" | "error"> = {
  USER: "neutral",
  DEALER: "info",
  ADMIN: "warning",
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
  const now = new Date();
  const paidEntitlementWhere = getPaidSubscriptionEntitlementWhere(now);

  const where = buildAdminUsersWhere({
    query,
    role: roleFilter,
    disabled: disabledFilter,
    deleted: params.disabled === "deleted",
  });

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
        _count: { select: { listings: true } },
      },
    }),
    db.user.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { q: query || undefined, role: roleFilter, disabled: params.disabled, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "undefined") p.set(k, v);
    }
    return `/admin/users?${p.toString()}`;
  }

  return (
    <>
      <AdminPageHeader
        title="Users"
        description="Manage account roles, dealer access, and account status."
      />

      <AdminFilterBar count={`${total} ${total === 1 ? "user" : "users"}`}>
        <form method="get" action="/admin/users" className="flex min-w-0 gap-2">
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
            <TableHead>User</TableHead>
            <TableHead>Access</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Dealer</TableHead>
            <TableHead className="text-right">Listings</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className={adminActionsCellClass}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
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
              <TableCell>
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
                </div>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {user.region?.name ?? (
                  <span className="text-text-tertiary">Not assigned</span>
                )}
              </TableCell>
              <TableCell>
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
              <TableCell className={adminNumericCellClass}>
                {user._count.listings}
              </TableCell>
              <TableCell className={adminDateCellClass}>
                {user.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className={adminActionsCellClass}>
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
              <AdminTableEmpty colSpan={7}>No users match these filters.</AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>

      <AdminPager
        page={page}
        totalPages={totalPages}
        hrefForPage={(nextPage) => buildUrl({ page: String(nextPage) })}
      />
    </>
  );
}
