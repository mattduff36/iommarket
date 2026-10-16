export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { hasOperationalDealerAccess } from "@/lib/dealers/entitlement";
import { DealerProfileForm } from "./dealer-profile-form";

export default async function DealerProfileManagePage() {
  const acceptedUser = await requireAcceptedUser("/dealer/profile");
  if (acceptedUser.role === "ADMIN") redirect("/admin");
  const user = acceptedUser;
  if (!hasDealerDashboardAccess(user)) redirect("/pricing");
  if (!(await hasOperationalDealerAccess(user))) redirect("/dealer/subscribe");

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="section-heading-accent font-heading text-2xl font-bold text-text-primary sm:text-3xl">
            Dealer profile
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            Update your public dealer profile details and contact information.
          </p>
        </div>
        <Link
          href={`/dealers/${user.dealerProfile.slug}`}
          className="text-sm text-text-secondary hover:text-text-primary hover:underline"
        >
          View public profile
        </Link>
      </div>

      <DealerProfileForm
        initialData={{
          name: user.dealerProfile.name,
          slug: user.dealerProfile.slug,
          bio: user.dealerProfile.bio,
          website: user.dealerProfile.website,
          phone: user.dealerProfile.phone,
          logoUrl: user.dealerProfile.logoUrl,
        }}
      />
    </div>
  );
}
