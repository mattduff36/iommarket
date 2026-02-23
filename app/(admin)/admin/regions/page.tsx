export const dynamic = "force-dynamic";

import type { Metadata } from "next";
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
import { RegionActions } from "./region-actions";
import { CreateRegionForm } from "./create-region-form";

export const metadata: Metadata = { title: "Regions | Admin" };

export default async function AdminRegionsPage() {
  const regions = await db.region.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { users: true, listings: true } },
    },
  });

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Regions</h1>

      <div className="mb-8">
        <CreateRegionForm />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Listings</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {regions.map((region) => (
            <TableRow key={region.id}>
              <TableCell className="font-medium text-text-primary">{region.name}</TableCell>
              <TableCell className="text-sm text-text-tertiary font-mono">{region.slug}</TableCell>
              <TableCell>
                <Badge variant={region.active ? "success" : "neutral"}>
                  {region.active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">{region._count.users}</TableCell>
              <TableCell className="text-sm text-text-secondary">{region._count.listings}</TableCell>
              <TableCell className="text-sm text-text-tertiary">
                {region.createdAt.toLocaleDateString("en-GB")}
              </TableCell>
              <TableCell>
                <RegionActions
                  regionId={region.id}
                  active={region.active}
                  hasReferences={region._count.users > 0 || region._count.listings > 0}
                />
              </TableCell>
            </TableRow>
          ))}
          {regions.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-text-tertiary py-8">
                No regions found. Add one above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}
