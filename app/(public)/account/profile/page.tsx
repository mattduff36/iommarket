import { AdminPageHeader } from "@/components/admin/admin-page-header";
export const dynamic = "force-dynamic";

import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { ProfileSecurityForm } from "./profile-security-form";

export default async function AccountProfilePage() {
  const user = await requireAcceptedUser("/account/profile");

  const regions = await db.region.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  return (
    <div>
      <AdminPageHeader title="Profile & Security"
          description="Update your profile details and manage account security settings." />

      <ProfileSecurityForm
        user={{
          name: user.name ?? "",
          email: user.email,
          phone: user.phone ?? null,
          bio: user.bio ?? null,
          avatarUrl: user.avatarUrl ?? null,
          regionId: user.regionId ?? null,
          hasDealerProfile: Boolean(user.dealerProfile),
        }}
        regions={regions}
      />
    </div>
  );
}
