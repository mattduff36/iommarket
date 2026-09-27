export const dynamic = "force-dynamic";

import type { Metadata } from "next";
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
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  AdminTable,
  AdminTableEmpty,
  adminActionsCellClass,
  adminDateCellClass,
  adminNumericCellClass,
} from "@/components/admin/admin-table";
import { RegionActions } from "./region-actions";
import { CreateRegionForm } from "./create-region-form";

export const metadata: Metadata = { title: "Regions | Admin" };

export default async function AdminRegionsPage() {
  const regions = await db.region.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { users: true, listings: true } },
    },
  });

  return (
    <>
      <AdminPageHeader
        title="Regions"
        description="Manage the locations available to users and marketplace listings."
        meta={`${regions.length} ${regions.length === 1 ? "region" : "regions"}`}
      />

      <div className="mb-8">
        <CreateRegionForm />
      </div>

      <AdminTable minWidth="wide">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Order</TableHead>
            <TableHead className="text-right">Users</TableHead>
            <TableHead className="text-right">Listings</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className={adminActionsCellClass}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {regions.map((region) => (
            <TableRow key={region.id}>
              <TableCell>
                <AdminDataCell title={region.name} subtitle={region.slug} />
              </TableCell>
              <TableCell>
                <Badge variant={region.active ? "success" : "neutral"}>
                  {region.active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className={adminNumericCellClass}>{region.sortOrder}</TableCell>
              <TableCell className={adminNumericCellClass}>{region._count.users}</TableCell>
              <TableCell className={adminNumericCellClass}>{region._count.listings}</TableCell>
              <TableCell className={adminDateCellClass}>
                {region.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell className={adminActionsCellClass}>
                <RegionActions
                  regionId={region.id}
                  regionName={region.name}
                  active={region.active}
                  hasReferences={region._count.users > 0 || region._count.listings > 0}
                />
              </TableCell>
            </TableRow>
          ))}
          {regions.length === 0 && (
            <TableRow>
              <AdminTableEmpty colSpan={7}>No regions found. Add one above.</AdminTableEmpty>
            </TableRow>
          )}
        </TableBody>
      </AdminTable>
    </>
  );
}
