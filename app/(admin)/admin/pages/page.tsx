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
import { RestorePageButton } from "./restore-page-button";

export const metadata: Metadata = { title: "Content Pages | Admin" };

export default async function AdminPagesListPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const params = await searchParams;
  const showDeleted = params.deleted === "1";
  const pages = await db.contentPage.findMany({
    where: { deletedAt: showDeleted ? { not: null } : null },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Content Pages</h1>
        <div className="flex items-center gap-3">
          <Link
            href={showDeleted ? "/admin/pages" : "/admin/pages?deleted=1"}
            className="text-sm text-text-secondary hover:text-text-primary"
          >
            {showDeleted ? "Active pages" : "Deleted pages"}
          </Link>
          <Link
            href="/admin/pages/new"
            className="inline-flex h-8 items-center justify-center rounded-md border border-neon-blue-500/25 bg-neon-blue-500/10 px-3 text-xs font-medium text-neon-blue-400 transition-colors hover:border-neon-blue-500/45 hover:bg-neon-blue-500/15 hover:text-neon-blue-500"
          >
            New Page
          </Link>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pages.map((page) => (
            <TableRow key={page.id}>
              <TableCell className="font-medium text-text-primary">{page.title}</TableCell>
              <TableCell className="text-sm text-text-tertiary font-mono">/{page.slug}</TableCell>
              <TableCell>
                <Badge variant={page.status === "PUBLISHED" ? "success" : "neutral"}>
                  {page.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-text-tertiary">
                {page.updatedAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell>
                {page.deletedAt ? (
                  <RestorePageButton id={page.id} />
                ) : (
                  <Link
                    href={`/admin/pages/${page.id}`}
                    className="text-sm text-neon-blue-400 hover:underline"
                  >
                    Edit
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
          {pages.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-text-tertiary py-8">
                No content pages yet. Create one to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
