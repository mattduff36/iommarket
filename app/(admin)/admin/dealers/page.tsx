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
import { DealerActions } from "./dealer-actions";
import { getPaidSubscriptionEntitlementWhere } from "@/lib/dealers/entitlement";
import { getDealerPackageLabel } from "@/lib/config/dealer-tiers";
import { buildAdminDealersWhere } from "@/lib/admin/dealer-query";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Dealers | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    verified?: string;
    page?: string;
    id?: string;
  }>;
}

const PAGE_SIZE = 25;

export default async function AdminDealersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q ?? "";
  const verifiedFilter = params.verified === "true" ? true : params.verified === "false" ? false : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const now = new Date();

  const where: Prisma.DealerProfileWhereInput = buildAdminDealersWhere({
    query,
    verified: verifiedFilter,
    id: params.id,
  });

  const [dealers, total] = await Promise.all([
    db.dealerProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { id: true, email: true, name: true, role: true, disabledAt: true } },
        _count: { select: { listings: true, subscriptions: true } },
        subscriptions: {
          where: {
            OR: [
              getPaidSubscriptionEntitlementWhere(now),
              {
                source: "ADMIN_GRANT",
                status: "ACTIVE",
                revokedAt: null,
                grantStartsAt: { lte: now },
                grantEndsAt: { gt: now },
              },
            ],
          },
          select: {
            id: true,
            source: true,
            currentPeriodEnd: true,
            grantStartsAt: true,
            grantEndsAt: true,
            revokedAt: true,
          },
        },
      },
    }),
    db.dealerProfile.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { q: query || undefined, verified: params.verified, id: params.id, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "undefined") p.set(k, v);
    }
    return `/admin/dealers?${p.toString()}`;
  }

  return (
    <>
      <AdminPageHeader
        title="Dealers"
        description="Review dealer identity, verification, plans, and current access."
      />

      <AdminFilterBar count={`${total} ${total === 1 ? "dealer" : "dealers"}`}>
        <form method="get" action="/admin/dealers" className="flex min-w-0 gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search name, slug, or email..."
            aria-label="Search dealers"
            className={adminSearchInputClass}
          />
          <button
            type="submit"
            className={adminSearchButtonClass}
          >
            Search
          </button>
        </form>

        <AdminFilterChip
          href={buildUrl({ verified: verifiedFilter === true ? undefined : "true", page: "1" })}
          active={verifiedFilter === true}
          activeTone="success"
        >
          Verified
        </AdminFilterChip>
        <AdminFilterChip
          href={buildUrl({ verified: verifiedFilter === false ? undefined : "false", page: "1" })}
          active={verifiedFilter === false}
        >
          Unverified
        </AdminFilterChip>
      </AdminFilterBar>

      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Plan &amp; access</TableHead>
            <TableHead className="text-right">Listings</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className={adminActionsCellClass}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dealers.map((dealer) => (
            <DealerRow key={dealer.id} dealer={dealer} />
          ))}
          {dealers.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={7}>No dealers match these filters.</AdminTableEmpty>
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

interface DealerRowProps {
  dealer: {
    id: string;
    name: string;
    slug: string;
    tier: "STARTER" | "PRO";
    verified: boolean;
    createdAt: Date;
    user: {
      id: string;
      email: string;
      name: string | null;
      role: "USER" | "DEALER" | "ADMIN";
      disabledAt: Date | null;
    };
    _count: { listings: number; subscriptions: number };
    subscriptions: Array<{
      id: string;
      source: "PAYMENT" | "ADMIN_GRANT";
      currentPeriodEnd: Date | null;
      grantStartsAt: Date | null;
      grantEndsAt: Date | null;
      revokedAt: Date | null;
    }>;
  };
}

function DealerRow({ dealer }: DealerRowProps) {
  const now = new Date();
  const paidSubscription = dealer.subscriptions.find(
    (subscription) => subscription.source === "PAYMENT"
  );
  const adminGrant = dealer.subscriptions.find(
    (subscription) =>
      subscription.source === "ADMIN_GRANT" &&
      !subscription.revokedAt &&
      subscription.grantStartsAt !== null &&
      subscription.grantStartsAt <= now &&
      subscription.grantEndsAt !== null &&
      subscription.grantEndsAt > now
  );
  const access = paidSubscription ?? adminGrant;

  return (
    <TableRow>
      <TableCell>
        <AdminDataCell
          title={<span className="block max-w-52 truncate">{dealer.name}</span>}
          subtitle={dealer.slug}
        />
      </TableCell>
      <TableCell>
        <AdminDataCell
          title={
            <Link
              href={`/admin/users/${dealer.user.id}`}
              className="block max-w-52 truncate text-neon-blue-400 hover:underline"
            >
              {dealer.user.name ?? dealer.user.email}
            </Link>
          }
          subtitle={
            dealer.user.name ? (
              <span className="block max-w-52 truncate">{dealer.user.email}</span>
            ) : undefined
          }
          badges={dealer.user.disabledAt ? <Badge variant="error">Disabled</Badge> : null}
        />
      </TableCell>
      <TableCell>
        <Badge variant={dealer.verified ? "success" : "neutral"}>
          {dealer.verified ? "Verified" : "Unverified"}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex max-w-48 flex-wrap gap-1.5">
          <Badge variant={dealer.tier === "PRO" ? "info" : "neutral"}>
            {getDealerPackageLabel(dealer.tier)}
          </Badge>
          <Badge variant={access ? (access.source === "ADMIN_GRANT" ? "warning" : "success") : "neutral"}>
            {access ? (access.source === "ADMIN_GRANT" ? "Free grant" : "Paid") : "No access"}
          </Badge>
        </div>
        {access ? (
          <p className="mt-1 text-xs tabular-nums text-text-tertiary">
            Ends{" "}
            {(access.source === "ADMIN_GRANT"
              ? access.grantEndsAt
              : access.currentPeriodEnd
            )?.toLocaleDateString("en-GB") ?? "not set"}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={adminNumericCellClass}>
        {dealer._count.listings}
      </TableCell>
      <TableCell className={adminDateCellClass}>
        {dealer.createdAt.toLocaleDateString("en-GB")}
      </TableCell>
      <TableCell className={adminActionsCellClass}>
        <DealerActions
          dealerId={dealer.id}
          dealerName={dealer.name}
          userId={dealer.user.id}
          userLabel={dealer.user.name ?? dealer.user.email}
          verified={dealer.verified}
          canGrantAccess={dealer.user.role === "DEALER"}
          currentTier={dealer.tier}
          hasActivePaidSubscription={Boolean(paidSubscription)}
        />
      </TableCell>
    </TableRow>
  );
}
