export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEditableDraft } from "@/lib/listings/editable-draft";
import { getCloudinaryUploadPreset } from "@/lib/upload/cloudinary";
import { Button } from "@/components/ui/button";
import { CreateListingForm } from "../create-listing-form";
import { getSellFormData } from "../sell-form-data";

export const metadata: Metadata = {
  title: "Dealer Listing",
  description: "Create a dealer listing on itrader.im.",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureAdminDealerProfile(user: {
  id: string;
  name: string | null;
  email: string;
}) {
  const baseRaw =
    user.name?.trim() || user.email.split("@")[0] || `admin-${user.id.slice(-6)}`;
  const base = slugify(baseRaw) || `admin-${user.id.slice(-6)}`;
  const profileName = user.name?.trim() || `${baseRaw} Dealer`;

  for (let i = 0; i < 100; i += 1) {
    const slug = i === 0 ? `${base}-dealer` : `${base}-dealer-${i}`;
    const existing = await db.dealerProfile.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) continue;

    return db.dealerProfile.create({
      data: {
        userId: user.id,
        name: profileName,
        slug,
      },
    });
  }

  throw new Error("Failed to provision dealer profile for admin user.");
}

interface Props {
  searchParams?: Promise<{
    draft?: string;
  }>;
}

export default async function SellDealerPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-up?next=/sell/dealer");
  if (user.role === "USER") redirect("/sell/private");
  let dealerProfile = user.dealerProfile;
  const params = searchParams ? await searchParams : {};
  const draftId = params.draft?.trim();

  if (!dealerProfile && user.role === "ADMIN") {
    dealerProfile = await ensureAdminDealerProfile(user);
  }

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

  const activeSubscription = await db.subscription.findFirst({
    where: {
      dealerId: dealerProfile.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (!activeSubscription && !initialDraft) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8 space-y-4">
        <h1 className="text-3xl font-bold text-text-primary">Dealer Listing</h1>
        <p className="text-text-secondary">
          An active dealer subscription is required before you can create new dealer listings.
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

  const { categories, regions } = await getSellFormData();
  const cloudinaryUploadPreset = getCloudinaryUploadPreset();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
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
        mode="dealer"
        cloudinaryUploadPreset={cloudinaryUploadPreset}
        initialDraft={initialDraft}
      />
    </div>
  );
}
