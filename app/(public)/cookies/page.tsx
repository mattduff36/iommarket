import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookies",
  description: "Cookie policy for iTrader.im.",
};

export default function CookiesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Cookie Policy
      </h1>
      <div className="mt-6 space-y-4 text-sm text-text-secondary leading-relaxed">
        <p>
          We use essential cookies to maintain secure sessions and core marketplace
          functionality. Optional analytics cookies may be enabled in production.
        </p>
        <p>
          You can update your browser cookie settings at any time. Blocking essential
          cookies may affect site functionality.
        </p>
      </div>
    </div>
  );
}
