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
import { UserActions } from "./user-actions";
import type { Prisma } from "@prisma/client";

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

const PAGE_SIZE = 25;

export default async function AdminUsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q ?? "";
  const roleFilter = params.role as "USER" | "DEALER" | "ADMIN" | undefined;
  const disabledFilter = params.disabled === "true" ? true : params.disabled === "false" ? false : undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const where: Prisma.UserWhereInput = {};
  if (query) {
    where.OR = [
      { email: { contains: query, mode: "insensitive" } },
      { name: { contains: query, mode: "insensitive" } },
    ];
  }
  if (roleFilter) where.role = roleFilter;
  if (disabledFilter === true) where.disabledAt = { not: null };
  if (disabledFilter === false) where.disabledAt = null;

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        region: { select: { name: true } },
        dealerProfile: { select: { id: true, name: true, verified: true } },
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
      <h1 className="text-2xl font-bold text-text-primary mb-6">Users</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <form method="get" action="/admin/users" className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search email or name..."
            className="h-9 w-64 rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
          />
          {roleFilter && <input type="hidden" name="role" value={roleFilter} />}
          <button
            type="submit"
            className="h-9 px-3 rounded-md bg-surface-elevated text-sm font-medium text-text-primary hover:bg-surface border border-border"
          >
            Search
          </button>
        </form>

        <div className="flex gap-1">
          {(["USER", "DEALER", "ADMIN"] as const).map((r) => (
            <Link
              key={r}
              href={buildUrl({ role: roleFilter === r ? undefined : r, page: "1" })}
              className={`h-9 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
                roleFilter === r
                  ? "bg-surface-elevated text-text-primary border-border"
                  : "text-text-secondary border-transparent hover:bg-surface-elevated"
              }`}
            >
              {r}
            </Link>
          ))}
        </div>

        <Link
          href={buildUrl({
            disabled: disabledFilter === true ? undefined : "true",
            page: "1",
          })}
          className={`h-9 inline-flex items-center px-3 rounded-md text-xs font-medium border transition-colors ${
            disabledFilter === true
              ? "bg-neon-red-500/10 text-neon-red-400 border-neon-red-500/30"
              : "text-text-secondary border-transparent hover:bg-surface-elevated"
          }`}
        >
          Disabled only
        </Link>

        <span className="text-xs text-text-tertiary ml-auto">{total} users</span>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Dealer</TableHead>
            <TableHead>Listings</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <Link
                  href={`/admin/users/${user.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {user.name ?? "—"}
                </Link>
                <p className="text-xs text-text-tertiary">{user.email}</p>
                {user.disabledAt && (
                  <Badge variant="error" className="mt-1">Disabled</Badge>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={ROLE_BADGE[user.role] ?? "neutral"}>
                  {user.role}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {user.region?.name ?? "—"}
              </TableCell>
              <TableCell>
                {user.dealerProfile ? (
                  <Link
                    href={`/admin/dealers?id=${user.dealerProfile.id}`}
                    className="text-sm text-neon-blue-400 hover:underline"
                  >
                    {user.dealerProfile.name}
                    {user.dealerProfile.verified && (
                      <Badge variant="success" className="ml-1">Verified</Badge>
                    )}
                  </Link>
                ) : (
                  <span className="text-text-tertiary text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {user._count.listings}
              </TableCell>
              <TableCell className="text-sm text-text-tertiary">
                {user.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell>
                <UserActions
                  userId={user.id}
                  currentRole={user.role}
                  isDisabled={!!user.disabledAt}
                />
              </TableCell>
            </TableRow>
          ))}
          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-text-tertiary py-8">
                No users found.
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
