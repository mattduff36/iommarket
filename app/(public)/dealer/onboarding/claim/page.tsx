import type { Metadata } from "next";
import { OnboardingClaimForm } from "./onboarding-claim-form";

export const metadata: Metadata = { title: "Claim your dealer account" };

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function DealerOnboardingClaimPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = params.token?.trim() ?? "";

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-text-primary">Claim your dealer account</h1>
      {token.length < 32 ? (
        <p className="mt-4 text-sm text-text-secondary">
          This invitation link is not valid. Open the onboarding email from iTrader and use the button in that message.
        </p>
      ) : (
        <div className="mt-6">
          <OnboardingClaimForm token={token} />
        </div>
      )}
    </div>
  );
}
