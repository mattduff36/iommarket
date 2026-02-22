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
import { AddAttributeForm } from "./add-attribute-form";
import { AttributeDeleteButton, CategoryRowActions } from "./category-actions";

export const metadata: Metadata = { title: "Manage Categories" };

const DATA_TYPE_LABEL: Record<string, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  boolean: "Bool",
};

export default async function AdminCategoriesPage() {
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      parent: { select: { name: true } },
      attributeDefinitions: { orderBy: { sortOrder: "asc" } },
      _count: { select: { listings: true } },
    },
  });

  const topLevelCategories = categories.filter((c) => !c.parentId);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Categories</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage categories and their filterable attributes.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ── Table ── */}
        <div className="lg:col-span-2 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Attributes</TableHead>
                <TableHead>Listings</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell className="text-text-secondary font-mono text-xs">
                    {cat.slug}
                  </TableCell>
                  <TableCell className="text-text-secondary text-sm">
                    {cat.parent?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    {cat.attributeDefinitions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {cat.attributeDefinitions.map((attr) => (
                          <span
                            key={attr.id}
                            className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-text-primary"
                            title={`${DATA_TYPE_LABEL[attr.dataType] ?? attr.dataType}${attr.required ? " · required" : ""}${attr.options ? ` · options: ${attr.options}` : ""}`}
                          >
                            {attr.name}
                            <span className="text-text-tertiary text-[10px]">
                              {DATA_TYPE_LABEL[attr.dataType] ?? attr.dataType}
                            </span>
                            {attr.required && (
                              <span className="text-neon-blue-400 text-[10px]">*</span>
                            )}
                            <AttributeDeleteButton attrId={attr.id} attrName={attr.name} />
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-tertiary text-xs">None</span>
                    )}
                  </TableCell>
                  <TableCell>{cat._count.listings}</TableCell>
                  <TableCell>
                    <Badge variant={cat.active ? "success" : "neutral"}>
                      {cat.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <CategoryRowActions
                      categoryId={cat.id}
                      active={cat.active}
                      listingCount={cat._count.listings}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* ── Right panel ── */}
        <div className="flex flex-col gap-6">
          <CreateCategoryForm
            parentCategories={topLevelCategories.map((c) => ({ id: c.id, name: c.name }))}
          />
          <AddAttributeForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
        </div>
      </div>
    </>
  );
}
