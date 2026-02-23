import type { Metadata } from "next";
import { getPublishedPage } from "@/lib/cms/get-page";
import { MarkdownRenderer } from "@/components/cms/markdown-renderer";

const FALLBACK_CONTENT = `iTrader.im provides a marketplace platform for users to list and discover vehicles on the Isle of Man. You are responsible for the accuracy of your listing and communications.

Listings may be moderated and removed if they breach our trust and safety standards. Payments for paid products are processed by Stripe.

Final legal copy should be reviewed by legal counsel prior to launch.`;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedPage("terms");
  return {
    title: page?.metaTitle ?? "Terms",
    description: page?.metaDescription ?? "Terms of use for iTrader.im.",
  };
}

export default async function TermsPage() {
  const page = await getPublishedPage("terms");

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        {page?.title ?? "Terms of Use"}
      </h1>
      <div className="mt-6">
        {page ? (
          <MarkdownRenderer content={page.markdown} />
        ) : (
          <div className="space-y-4 text-sm text-text-secondary leading-relaxed">
            {FALLBACK_CONTENT.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
