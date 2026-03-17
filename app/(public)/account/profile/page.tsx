export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ProfileSecurityForm } from "./profile-security-form";

export default async function AccountProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/account/profile");

  const regions = await db.region.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Profile &amp; Security
      </h1>
      <p className="mt-2 text-sm text-text-secondary mb-6">
        Update your profile details and manage account security settings.
      </p>

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
