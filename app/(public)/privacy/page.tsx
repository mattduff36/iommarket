import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy policy for iTrader.im.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Privacy Policy
      </h1>
      <div className="mt-6 space-y-4 text-sm text-text-secondary leading-relaxed">
        <p>
          We collect and process personal data required to operate marketplace
          functionality, including account, listing, and safety workflows.
        </p>
        <p>
          We do not sell personal data. Payment data is processed by Stripe and
          authentication is handled by Supabase.
        </p>
        <p>
          Final legal copy should be reviewed by legal counsel prior to launch.
        </p>
      </div>
    </div>
  );
}
