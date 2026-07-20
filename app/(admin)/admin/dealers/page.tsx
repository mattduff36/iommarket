export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getAdminDealerWhere } from "@/lib/dealers/access";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { DealerActions } from "./dealer-actions";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "Dealers | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    verified?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 25;

export default async function AdminDealersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q ?? "";
  const verifiedFilter = params.verified === "true" ? true : params.verified === "false" ? false : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const where: Prisma.DealerProfileWhereInput = getAdminDealerWhere();
  if (query) {
    where.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { slug: { contains: query, mode: "insensitive" } },
      { user: { email: { contains: query, mode: "insensitive" } } },
    ];
  }
  if (verifiedFilter !== undefined) where.verified = verifiedFilter;

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
          where: { status: "ACTIVE" },
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
    const merged = { q: query || undefined, verified: params.verified, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "undefined") p.set(k, v);
    }
    return `/admin/dealers?${p.toString()}`;
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dealers</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6 rounded-lg border border-border bg-canvas/30 p-3">
        <form method="get" action="/admin/dealers" className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search name, slug, or email..."
            className="h-9 w-64 rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
          />
          <button
            type="submit"
            className="h-9 px-3 rounded-md bg-surface-elevated text-sm font-medium text-text-primary hover:bg-surface border border-border"
          >
            Search
          </button>
        </form>

        <Link
          href={buildUrl({ verified: verifiedFilter === true ? undefined : "true", page: "1" })}
          className={`h-9 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
            verifiedFilter === true
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
              : "text-text-secondary border-transparent hover:bg-surface-elevated"
          }`}
        >
          Verified
        </Link>
        <Link
          href={buildUrl({ verified: verifiedFilter === false ? undefined : "false", page: "1" })}
          className={`h-9 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
            verifiedFilter === false
              ? "bg-surface-elevated text-text-primary border-border"
              : "text-text-secondary border-transparent hover:bg-surface-elevated"
          }`}
        >
          Unverified
        </Link>

        <span className="text-xs text-text-tertiary ml-auto">{total} dealers</span>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Subscription</TableHead>
            <TableHead>Listings</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="min-w-[220px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dealers.map((dealer) => (
            <DealerRow key={dealer.id} dealer={dealer} />
          ))}
          {dealers.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-text-tertiary py-8">
                No dealers found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link
              href={buildUrl({ page: String(page - 1) })}
              className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-text-tertiary">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildUrl({ page: String(page + 1) })}
              className="h-9 px-3 rounded-md text-sm font-medium text-text-secondary hover:bg-surface-elevated border border-border"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </>
  );
}

interface DealerRowProps {
  dealer: {
    id: string;
    name: string;
    slug: string;
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
                <span className="font-medium text-text-primary">{dealer.name}</span>
                <p className="text-xs text-text-tertiary">{dealer.slug}</p>
              </TableCell>
              <TableCell>
                <Link
                  href={`/admin/users/${dealer.user.id}`}
                  className="text-sm text-neon-blue-400 hover:underline"
                >
                  {dealer.user.name ?? dealer.user.email}
                </Link>
                {dealer.user.disabledAt && (
                  <Badge variant="error" className="ml-1">Disabled</Badge>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={dealer.verified ? "success" : "neutral"}>
                  {dealer.verified ? "Verified" : "Unverified"}
                </Badge>
              </TableCell>
              <TableCell>
                {access ? (
                  <div className="space-y-1">
                    <Badge variant="success">
                      {access.source === "ADMIN_GRANT" ? "Free grant" : "Paid"}
                    </Badge>
                    <p className="text-xs text-text-tertiary">
                      ends{" "}
                      {(access.source === "ADMIN_GRANT"
                        ? access.grantEndsAt
                        : access.currentPeriodEnd
                      )?.toLocaleDateString("en-GB") ?? "—"}
                    </p>
                  </div>
                ) : (
                  <Badge variant="neutral">None</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {dealer._count.listings}
              </TableCell>
              <TableCell className="text-sm text-text-tertiary">
                {dealer.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className="min-w-[220px]">
                <DealerActions
                  dealerId={dealer.id}
                  userId={dealer.user.id}
                  userLabel={dealer.user.name ?? dealer.user.email}
                  verified={dealer.verified}
                  canGrantAccess={dealer.user.role === "DEALER"}
                />
              </TableCell>
    </TableRow>
  );
}
