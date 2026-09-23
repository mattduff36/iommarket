import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { readOnboardingClaimCookie } from "@/lib/dealers/onboarding/claim-cookie";
import { ONBOARDING_PRO_END_LABEL } from "@/lib/dealers/onboarding/grant-plan";
import { hashOnboardingToken, onboardingTokenMatches } from "@/lib/dealers/onboarding/tokens";
import { OnboardingAcceptForm } from "./onboarding-accept-form";

export const metadata: Metadata = { title: "Accept dealer terms" };

export default async function DealerOnboardingAcceptPage() {
  const token = await readOnboardingClaimCookie();
  if (!token) {
    return (
      <OnboardingMessage
        title="Use your invitation email"
        body="Open the dealer onboarding email and press Continue securely before accepting the documents."
      />
    );
  }

  const invite = await db.dealerOnboardingInvite.findUnique({
    where: { tokenHash: hashOnboardingToken(token) },
    include: { dealer: { select: { name: true } } },
  });
  if (!invite || !onboardingTokenMatches(token, invite.tokenHash)) {
    return (
      <OnboardingMessage
        title="This invitation is not valid"
        body="Ask iTrader to send a new onboarding email."
      />
    );
  }
  if (invite.status === "COMPLETED") {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <h1 className="text-2xl font-bold text-text-primary">Your dealer account is ready</h1>
        <p className="text-sm text-text-secondary">
          Sign in with the owner email and the password you chose.
        </p>
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== invite.targetAuthUserId) {
    return (
      <OnboardingMessage
        title="Continue from the invitation"
        body="The secure sign-in step has not finished. Open the email and press Continue securely again."
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-text-primary">Activate {invite.dealer.name}</h1>
      <p className="mt-3 text-sm text-text-secondary">
        Complimentary Dealer Pro starts when you accept and ends at {ONBOARDING_PRO_END_LABEL}. Your existing dealer profile and listings stay on this account.
      </p>
      <div className="mt-6">
        <OnboardingAcceptForm />
      </div>
    </div>
  );
}

function OnboardingMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
      <p className="mt-3 text-sm text-text-secondary">{body}</p>
    </div>
  );
}
