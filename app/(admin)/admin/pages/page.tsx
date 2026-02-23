export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Content Pages | Admin" };

export default async function AdminPagesListPage() {
  const pages = await db.contentPage.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Content Pages</h1>
        <Link href="/admin/pages/new">
          <Button size="sm">New Page</Button>
        </Link>
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
                <Link
                  href={`/admin/pages/${page.id}`}
                  className="text-sm text-neon-blue-400 hover:underline"
                >
                  Edit
                </Link>
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
