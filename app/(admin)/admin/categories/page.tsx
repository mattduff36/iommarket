export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreateCategoryForm } from "./create-category-form";

export const metadata: Metadata = { title: "Manage Categories" };

export default async function AdminCategoriesPage() {
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      parent: { select: { name: true } },
      attributeDefinitions: { orderBy: { sortOrder: "asc" } },
      _count: { select: { listings: true } },
    },
  });

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Categories</h1>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Attributes</TableHead>
                <TableHead>Listings</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell className="text-text-secondary font-mono text-xs">
                    {cat.slug}
                  </TableCell>
                  <TableCell>{cat.parent?.name ?? "—"}</TableCell>
                  <TableCell>
                    {cat.attributeDefinitions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {cat.attributeDefinitions.map((attr) => (
                          <Badge key={attr.id} variant="neutral">
                            {attr.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-tertiary">None</span>
                    )}
                  </TableCell>
                  <TableCell>{cat._count.listings}</TableCell>
                  <TableCell>
                    <Badge variant={cat.active ? "success" : "neutral"}>
                      {cat.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <CreateCategoryForm
            parentCategories={categories
              .filter((c) => !c.parentId)
              .map((c) => ({ id: c.id, name: c.name }))}
          />
        </div>
      </div>
    </>
  );
}
