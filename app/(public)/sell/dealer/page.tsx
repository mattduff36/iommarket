export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { db } from "@/lib/db";
import { ensureAdminDealerProfile } from "@/lib/dealers/access";
import { hasOperationalDealerAccess } from "@/lib/dealers/entitlement";
import { getEditableDraft } from "@/lib/listings/editable-draft";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { CreateListingForm } from "../create-listing-form";
import { getPolicyFlags } from "@/lib/policy/flags";
import { getSellFormData } from "../sell-form-data";

export const metadata: Metadata = {
  title: "Dealer Listing",
  description: "Create a dealer listing on itrader.im.",
};

interface Props {
  searchParams?: Promise<{
    draft?: string;
  }>;
}

export default async function SellDealerPage({ searchParams }: Props) {
  const acceptedUser = await requireAcceptedUser("/sell/dealer");
  if (acceptedUser.role === "USER") redirect("/sell/private");
  const user = await ensureAdminDealerProfile(acceptedUser, db);
  const dealerProfile = user.dealerProfile;
  const params = searchParams ? await searchParams : {};
  const draftId = params.draft?.trim();

  if (!dealerProfile) redirect("/dealer/subscribe");

  const initialDraft = draftId
    ? await getEditableDraft({
        draftId,
        userId: user.id,
        dealerId: dealerProfile.id,
      })
    : null;
  if (draftId && !initialDraft) {
    redirect("/dealer/dashboard?status=DRAFT");
  }

  const operationalAccess = await hasOperationalDealerAccess({
    role: user.role,
    dealerProfile,
  });

  if (!operationalAccess && !initialDraft) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-4">
        <Breadcrumbs
          items={[
            { label: "Sell", href: "/sell" },
            { label: "Dealer listing", href: "/sell/dealer" },
          ]}
          structuredData={false}
        />
        <h1 className="text-3xl font-bold text-text-primary">Dealer Listing</h1>
        <p className="text-text-secondary">
          Active dealer access is required before you can create new dealer listings.
        </p>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link href="/dealer/subscribe">Subscribe Now</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/pricing">View Plans</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { categories, regions, vehicleMakes } = await getSellFormData();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[
          { label: "Sell", href: "/sell" },
          { label: "Dealer listing", href: "/sell/dealer" },
        ]}
        structuredData={false}
      />
      <h1 className="text-3xl font-bold text-text-primary mb-2">
        {initialDraft ? "Continue Editing Your Dealer Draft" : "Create a Dealer Listing"}
      </h1>
      <p className="text-text-secondary mb-8">
        {initialDraft
          ? "Update your saved dealer draft and continue when the vehicle is ready to submit."
          : "Publish inventory from your dealer account. Your listing is submitted for moderation after this step."}
      </p>

      <CreateListingForm
        categories={categories}
        regions={regions}
        vehicleMakes={vehicleMakes}
        mode="dealer"
        initialDraft={initialDraft}
        enforceListingNs={getPolicyFlags().enforceListingNs}
      />
    </div>
  );
}
