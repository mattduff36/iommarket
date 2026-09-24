export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AdminDataCell } from "@/components/admin/admin-data-cell";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
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
      <AdminPageHeader
        title="Categories"
        description="Manage marketplace categories and their filterable attributes."
        meta={`${categories.length} ${categories.length === 1 ? "category" : "categories"}`}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <AdminTable minWidth="wide">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Attributes</TableHead>
                <TableHead className="text-right">Listings</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className={adminActionsCellClass}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell>
                    <AdminDataCell title={cat.name} subtitle={cat.slug} />
                  </TableCell>
                  <TableCell className="text-text-secondary text-sm">
                    {cat.parent?.name ?? "-"}
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
                  <TableCell className={adminNumericCellClass}>
                    {cat._count.listings}
                  </TableCell>
                  <TableCell>
                    <Badge variant={cat.active ? "success" : "neutral"}>
                      {cat.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className={adminActionsCellClass}>
                    <CategoryRowActions
                      categoryId={cat.id}
                      categoryName={cat.name}
                      active={cat.active}
                      listingCount={cat._count.listings}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {categories.length === 0 ? (
                <TableRow>
                  <AdminTableEmpty colSpan={6}>
                    No categories found. Add one from the form.
                  </AdminTableEmpty>
                </TableRow>
              ) : null}
            </TableBody>
          </AdminTable>
        </div>

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
