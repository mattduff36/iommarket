import Link from "next/link";
import { MarkdownRenderer } from "@/components/cms/markdown-renderer";
import { getPolicyDocument } from "@/lib/policies/loader";
import { LEGAL_NAV_ITEMS } from "@/lib/policies/registry";
import type { PolicySlug } from "@/lib/policies/types";

export function PolicyDocumentPage({ slug }: { slug: PolicySlug }) {
  const policy = getPolicyDocument(slug);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-xs uppercase tracking-[0.16em] text-text-tertiary">
        Version {policy.version} · Effective {policy.effectiveDate}
      </p>
      <h1 className="section-heading-accent mt-2 text-2xl font-bold font-heading text-text-primary sm:text-3xl">
        {policy.title}
      </h1>
      <div className="mt-6">
        <MarkdownRenderer content={policy.markdown} />
      </div>
      <nav
        aria-label="Legal documents"
        className="mt-12 border-t border-border pt-6"
      >
        <p className="text-sm font-medium text-text-primary">Related policies</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {LEGAL_NAV_ITEMS.filter((item) => item.href !== policy.route).map(
            (item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-neon-blue-400 hover:underline"
                >
                  {item.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
    </div>
  );
}
