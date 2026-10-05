export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminProfileEditForm } from "./profile-edit-form";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { buildDealerProfilePath } from "@/lib/navigation-paths";
import {
  applySampleUserVisibility,
  getSampleVisibility,
} from "@/lib/listings/sample-visibility";
export const metadata: Metadata = { title: "Edit profile | Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminProfileEditPage({ params }: Props) {
  const { id } = await params;
  const sampleVisibility = await getSampleVisibility();
  const user = await db.user.findFirst({
    where: applySampleUserVisibility({ id }, sampleVisibility),
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      bio: true,
      regionId: true,
      role: true,
      disabledAt: true,
      deletedAt: true,
      updatedAt: true,
      dealerProfile: {
        select: {
          id: true,
          name: true,
          slug: true,
          phone: true,
          website: true,
          bio: true,
          isAdminPreview: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!user) notFound();

  const regions = await db.region.findMany({
    where: user.regionId
      ? { OR: [{ active: true }, { id: user.regionId }] }
      : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });

  return (
    <>
      <AdminPageHeader
        title="Edit profile"
        description={user.name ?? user.email}
        meta={
          <>
            <Badge variant={user.role === "ADMIN" ? "error" : user.role === "DEALER" ? "info" : "neutral"}>
              {user.role}
            </Badge>
            {user.deletedAt ? <Badge variant="error">Deleted</Badge> : null}
            {user.disabledAt && !user.deletedAt ? <Badge variant="error">Disabled</Badge> : null}
            {user.dealerProfile?.isAdminPreview ? <Badge variant="warning">Preview pack</Badge> : null}
          </>
        }
        actions={
          <Link
            href={`/admin/users/${user.id}`}
            className="text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            &larr; Account
          </Link>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <IdentityRow label="Email" value={user.email} />
          <IdentityRow label="User ID" value={user.id} mono />
          <IdentityRow label="Dealership" value={user.dealerProfile?.name ?? "No dealer profile"} />
          <IdentityRow label="Dealer ID" value={user.dealerProfile?.id ?? "Not set"} mono />
          <IdentityRow
            label="Public path"
            value={
              user.dealerProfile ? buildDealerProfilePath(user.dealerProfile.slug) : "Not set"
            }
            mono
          />
        </CardContent>
      </Card>

      {user.deletedAt ? (
        <p className="text-sm text-text-error">
          This account is deleted. Restore it before editing the profile.
        </p>
      ) : (
        <AdminProfileEditForm
          userId={user.id}
          userUpdatedAt={user.updatedAt.toISOString()}
          accountName={user.name ?? ""}
          accountPhone={user.phone ?? ""}
          accountBio={user.bio ?? ""}
          regionId={user.regionId ?? ""}
          regions={regions.map((region) => ({
            id: region.id,
            name: region.active ? region.name : `${region.name} (inactive)`,
          }))}
          dealer={
            user.dealerProfile
              ? {
                  dealerId: user.dealerProfile.id,
                  slug: user.dealerProfile.slug,
                  name: user.dealerProfile.name,
                  phone: user.dealerProfile.phone ?? "",
                  website: user.dealerProfile.website ?? "",
                  bio: user.dealerProfile.bio ?? "",
                  updatedAt: user.dealerProfile.updatedAt.toISOString(),
                }
              : null
          }
          disabledAccount={Boolean(user.disabledAt)}
        />
      )}
    </>
  );
}

function IdentityRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-32 text-text-secondary">{label}:</span>
      <span className={mono ? "font-mono text-xs text-text-tertiary" : "text-text-primary"}>
        {value}
      </span>
    </div>
  );
}
