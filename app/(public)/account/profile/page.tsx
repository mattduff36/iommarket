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
      <div className="mb-6">
        <h1 className="section-heading-accent font-heading text-2xl font-bold text-text-primary sm:text-3xl">
          Profile &amp; Security
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-secondary">
          Update your profile details and manage account security settings.
        </p>
      </div>

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
