export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyEmailButton } from "./copy-email-button";
import { DeleteWaitlistButton } from "./delete-waitlist-button";

export const metadata: Metadata = { title: "Waitlist | Admin" };

interface Props {
  searchParams: Promise<{
    q?: string;
  }>;
}

type WaitlistRow = {
  id: string;
  email: string;
  interests: unknown;
  source: string;
  createdAt: Date;
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

  const where = query
    ? {
        email: {
          contains: query,
          mode: "insensitive" as const,
        },
      }
    : undefined;

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
    },
  });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Waitlist</h1>
          <p className="mt-1 text-sm text-text-tertiary">
            Pre-launch signups from the coming soon page.
          </p>
        </div>
        <Link
          href="/api/admin/waitlist/export"
          className="h-9 inline-flex items-center px-3 rounded-md bg-surface-elevated text-sm font-medium text-text-primary hover:bg-surface border border-border"
        >
          Export CSV
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form method="get" action="/admin/waitlist" className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by email..."
            className="h-9 w-64 rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
          />
          <button
            type="submit"
            className="h-9 px-3 rounded-md bg-surface-elevated text-sm font-medium text-text-primary hover:bg-surface border border-border"
          >
            Search
          </button>
        </form>
        <span className="ml-auto text-xs text-text-tertiary">
          {waitlistUsers.length} {waitlistUsers.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Interests</TableHead>
            <TableHead>Date joined</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {waitlistUsers.map((user) => {
            const interests = parseInterests(user.interests).map(formatInterestLabel);
            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium text-text-primary">{user.email}</TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {interests.length > 0 ? interests.join(", ") : "—"}
                </TableCell>
                <TableCell className="text-sm text-text-tertiary">
                  {user.createdAt.toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell className="text-xs text-text-tertiary">{user.source}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <CopyEmailButton email={user.email} />
                    <DeleteWaitlistButton id={user.id} email={user.email} />
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
          {waitlistUsers.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-text-tertiary">
                No waitlist entries found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
