import type { Metadata } from "next";
import { getPublishedPage } from "@/lib/cms/get-page";
import { MarkdownRenderer } from "@/components/cms/markdown-renderer";

const FALLBACK_CONTENT = `We collect and process personal data required to operate marketplace functionality, including account, listing, and safety workflows.

We do not sell personal data. Payment data is processed by Stripe and authentication is handled by Supabase.

Final legal copy should be reviewed by legal counsel prior to launch.`;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedPage("privacy");
  return {
    title: page?.metaTitle ?? "Privacy",
    description: page?.metaDescription ?? "Privacy policy for iTrader.im.",
  };
}

export default async function PrivacyPage() {
  const page = await getPublishedPage("privacy");

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        {page?.title ?? "Privacy Policy"}
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
