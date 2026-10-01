export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { HoldingHeader } from "@/components/layout/holding-header";
import { Button } from "@/components/ui/button";
import { resolveEarlyAccessInvite } from "@/lib/waitlist/early-access/invite";
import { earlyAccessClaimSchema } from "@/lib/validations/waitlist-early-access";
import { EarlyAccessContinueForm } from "./continue-form";

export const metadata: Metadata = {
  title: "Early access",
  robots: { index: false, follow: false },
};

export default async function EarlyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ recipient?: string; proof?: string }>;
}) {
  const params = await searchParams;
  const parsed = earlyAccessClaimSchema.safeParse({
    recipientId: params.recipient,
    proof: params.proof,
  });
  const invite = parsed.success
    ? await resolveEarlyAccessInvite(parsed.data.recipientId, parsed.data.proof)
    : null;

  return (
    <div className="min-h-screen bg-canvas">
      <HoldingHeader />
      <main className="mx-auto flex max-w-lg flex-col px-4 py-16 text-center">
        {invite && parsed.success ? (
          <>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-neon-blue-500">
              Early access
            </p>
            <h1 className="mt-3 text-3xl font-bold text-text-primary">Create your account</h1>
            <p className="mt-4 text-text-secondary">
              This invitation is locked to{" "}
              <span className="font-medium text-text-primary">{invite.email}</span>.
              Continue to choose a password and accept the terms.
            </p>
            <EarlyAccessContinueForm
              recipientId={parsed.data.recipientId}
              proof={parsed.data.proof}
            />
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-text-primary">Invitation unavailable</h1>
            <p className="mt-4 text-text-secondary">
              This early-access link is invalid, already used, or the site is now open to everyone.
              If you already created an account, sign in.
            </p>
            <Button asChild className="mt-8" variant="trust">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
