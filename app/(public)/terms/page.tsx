import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for iTrader.im.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Terms of Use
      </h1>
      <div className="mt-6 space-y-4 text-sm text-text-secondary leading-relaxed">
        <p>
          iTrader.im provides a marketplace platform for users to list and discover
          vehicles on the Isle of Man. You are responsible for the accuracy of your
          listing and communications.
        </p>
        <p>
          Listings may be moderated and removed if they breach our trust and safety
          standards. Payments for paid products are processed by Stripe.
        </p>
        <p>
          Final legal copy should be reviewed by legal counsel prior to launch.
        </p>
      </div>
    </div>
  );
}
