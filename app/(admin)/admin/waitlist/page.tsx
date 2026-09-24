export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import {
  AdminFilterBar,
  AdminFilterChip,
  adminSearchButtonClass,
  adminSearchInputClass,
} from "@/components/admin/admin-filter-bar";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
} from "@/components/admin/admin-table";
import { WaitlistRowActions } from "./waitlist-row-actions";

export const metadata: Metadata = { title: "Waitlist | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
    deleted?: string;
  }>;
}

type WaitlistRow = {
  id: string;
  email: string;
  interests: unknown;
  source: string;
  createdAt: Date;
  deletedAt: Date | null;
};

function parseInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function formatInterestLabel(interest: string): string {
  switch (interest) {
    case "BUYING_CARS":
      return "Buying cars";
    case "SELLING_CARS":
      return "Selling cars";
    case "DEALER":
      return "Dealer";
    default:
      return interest;
  }
}

export default async function AdminWaitlistPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const showDeleted = params.deleted === "1";

  const where = {
    deletedAt: showDeleted ? { not: null } : null,
    ...(query
      ? {
          email: {
            contains: query,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const waitlistUsers: WaitlistRow[] = await db.waitlistUser.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      email: true,
      interests: true,
      source: true,
      createdAt: true,
      deletedAt: true,
    },
  });

  return (
    <>
      <AdminPageHeader
        title="Waitlist"
        description="Review pre-launch signups captured from the coming soon page."
        actions={
          <Link
            href="/api/admin/waitlist/export"
            className={adminSearchButtonClass}
          >
            Export CSV
          </Link>
        }
      />

      <AdminFilterBar
        count={`${waitlistUsers.length} ${waitlistUsers.length === 1 ? "entry" : "entries"}`}
      >
        <form method="get" action="/admin/waitlist" className="flex min-w-0 gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by email..."
            aria-label="Search waitlist"
            className={adminSearchInputClass}
          />
          {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
          <button type="submit" className={adminSearchButtonClass}>
            Search
          </button>
        </form>
        <AdminFilterChip
          href={showDeleted ? "/admin/waitlist" : "/admin/waitlist?deleted=1"}
          active={showDeleted}
          activeTone="warning"
        >
          Deleted entries
        </AdminFilterChip>
      </AdminFilterBar>

      <AdminTable>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Interests</TableHead>
            <TableHead>Date joined</TableHead>
            <TableHead className={adminActionsCellClass}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {waitlistUsers.map((user) => {
            const interests = parseInterests(user.interests).map(formatInterestLabel);
            return (
              <TableRow key={user.id}>
                <TableCell>
                  <AdminDataCell title={user.email} subtitle={user.source} />
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {interests.length > 0 ? interests.join(", ") : "-"}
                </TableCell>
                <TableCell className={adminDateCellClass}>
                  {user.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell className={adminActionsCellClass}>
                  <WaitlistRowActions
                    id={user.id}
                    email={user.email}
                    deleted={Boolean(user.deletedAt)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
          {waitlistUsers.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={4}>No waitlist entries match these filters.</AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>
    </>
  );
}
