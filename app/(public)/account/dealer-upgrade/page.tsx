import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { findPendingDealerUpgradeOfferById } from "@/lib/dealers/upgrade-offers";
import { buildDealerUpgradePolicySnapshot } from "@/lib/dealers/upgrade-policy";
import { POLICY_DEFINITIONS } from "@/lib/policies/registry";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { DealerUpgradeForm } from "./dealer-upgrade-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review dealer upgrade",
  description:
    "Review the dealer documents and activate complimentary iTrader dealer access.",
};

export default async function DealerUpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string }>;
}) {
  const params = await searchParams;
  const offerId = z.string().cuid().safeParse(params.offer);
  if (!offerId.success) redirect("/account");
  const user = await requireAcceptedUser(
    `/account/dealer-upgrade?offer=${encodeURIComponent(offerId.data)}`,
  );
  const offer = await findPendingDealerUpgradeOfferById(offerId.data, user.id);
  if (!offer || user.role !== "USER") redirect("/account");

  const policy = buildDealerUpgradePolicySnapshot();
  const dealerTerms = POLICY_DEFINITIONS["dealer-terms"];
  const acceptableUse = POLICY_DEFINITIONS["acceptable-use"];
  const refunds = POLICY_DEFINITIONS.refunds;
  const dayLabel = offer.durationDays === 1 ? "day" : "days";

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:py-16">
      <div className="mb-7">
        <Badge variant="warning">Administrator offer</Badge>
        <h1 className="section-heading-accent mt-4 text-3xl font-bold font-heading text-text-primary">
          Your complimentary dealer upgrade
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          Your account is still a private-user account. Review the dealer documents
          below before choosing whether to activate the upgrade.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{offer.durationDays} {dayLabel} of dealer access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md border border-border bg-canvas/40 p-4">
            <p className="text-sm font-medium text-text-primary">
              Your access period starts when you accept
            </p>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              No payment will be taken. Your dealer profile, complimentary grant, and
              dealer role are activated together after acceptance.
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Documents included
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
              <li>{dealerTerms.title} · version {dealerTerms.version}</li>
              <li>{acceptableUse.title} · version {acceptableUse.version}</li>
              <li>{refunds.title} · version {refunds.version}</li>
            </ul>
          </div>

          <DealerUpgradeForm offerId={offer.id} policyDigest={policy.digest} />
        </CardContent>
      </Card>
    </main>
  );
}
