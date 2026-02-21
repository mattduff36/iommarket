import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact iTrader.im support.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        Contact
      </h1>
      <p className="mt-4 text-sm text-text-secondary">
        For support and moderation queries, email{" "}
        <a className="text-text-trust hover:underline" href="mailto:hello@itrader.im">
          hello@itrader.im
        </a>
        .
      </p>
    </div>
  );
}
