import type { Metadata } from "next";
import { getPublishedPage } from "@/lib/cms/get-page";
import { MarkdownRenderer } from "@/components/cms/markdown-renderer";

const FALLBACK_CONTENT = `We use essential cookies to maintain secure sessions and core marketplace functionality. Optional analytics cookies may be enabled in production.

You can update your browser cookie settings at any time. Blocking essential cookies may affect site functionality.`;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedPage("cookies");
  return {
    title: page?.metaTitle ?? "Cookies",
    description: page?.metaDescription ?? "Cookie policy for iTrader.im.",
  };
}

export default async function CookiesPage() {
  const page = await getPublishedPage("cookies");

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        {page?.title ?? "Cookie Policy"}
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
