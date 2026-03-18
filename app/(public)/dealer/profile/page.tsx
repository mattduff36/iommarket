export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { DealerProfileForm } from "./dealer-profile-form";

export default async function DealerProfileManagePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up?next=/dealer/profile");
  if (!user.dealerProfile) redirect("/pricing");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
            Manage Dealer Profile
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Update your public dealer profile details and contact information.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/dealer/dashboard">Back to Dashboard</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/dealers/${user.dealerProfile.slug}`}>View Public Profile</Link>
          </Button>
        </div>
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
