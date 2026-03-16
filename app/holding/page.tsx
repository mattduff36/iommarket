import Image from "next/image";
import type { Metadata } from "next";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";
import { WaitlistForm } from "@/components/waitlist/waitlist-form";

export const metadata: Metadata = {
  title: "Coming Soon",
  description: "Join the iTrader.im waiting list for launch updates.",
};

export default function HoldingPage() {
  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={{ background: HERO_GRADIENT }}
    >
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <Image
          src="/images/logo-itrader.png"
          alt="iTrader.im – Buy · Sell · Upgrade"
          width={480}
          height={160}
          priority
          className="w-auto max-w-[260px] sm:max-w-[340px] drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
        />

        <div className="mt-10 inline-flex items-center gap-2.5 rounded-full border border-amber-500/30 bg-amber-500/[0.06] px-4 py-1.5">
          <svg className="h-3.5 w-2.5 shrink-0" viewBox="0 0 10 14" aria-hidden="true">
            <path d="M5 0L9 11H1L5 0Z" fill="#f59e0b" />
            <rect x="0" y="11.5" width="10" height="2" rx="0.5" fill="#d97706" />
          </svg>
          <span className="h-1.5 w-1.5 animate-strobe rounded-full bg-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-400">
            Under Construction
          </span>
          <span
            className="h-1.5 w-1.5 animate-strobe rounded-full bg-amber-400"
            style={{ animationDelay: "0.3s" }}
          />
          <svg className="h-3.5 w-2.5 shrink-0" viewBox="0 0 10 14" aria-hidden="true">
            <path d="M5 0L9 11H1L5 0Z" fill="#f59e0b" />
            <rect x="0" y="11.5" width="10" height="2" rx="0.5" fill="#d97706" />
          </svg>
        </div>

        <h1 className="mt-6 text-center font-heading font-bold leading-tight text-text-primary">
          <span className="block text-2xl sm:text-3xl lg:text-4xl">
            Isle of Man&apos;s
          </span>
          <span className="block text-3xl sm:text-4xl lg:text-5xl lg:leading-[1.15]">
            Dedicated Vehicle Marketplace
          </span>
        </h1>

        <p className="mt-5 text-center text-lg leading-relaxed text-metallic-300">
          A trusted local platform to buy and sell
          <br className="hidden sm:inline" />
          {" "}cars, vans and motorcycles.
        </p>

        <p className="mt-3 max-w-md text-center text-[15px] leading-relaxed text-text-secondary/80">
          We&apos;re building something special for the Isle of Man.
          <br />
          Join the waiting list to be first in line.
        </p>

        <div className="mx-auto mt-10 h-px w-12 bg-gradient-to-r from-transparent via-metallic-400/30 to-transparent sm:w-20" />

        <section className="mt-10 w-full max-w-lg rounded-2xl border border-white/[0.07] bg-white/[0.03] p-6 shadow-2xl ring-1 ring-white/[0.03] backdrop-blur-md sm:p-8">
          <h2 className="text-center text-lg font-semibold text-text-primary sm:text-xl">
            Join the Waiting List
          </h2>
          <p className="mt-1.5 text-center text-sm text-text-secondary">
            Be first to know when iTrader.im opens to the island.
          </p>
          <div className="mt-6">
            <WaitlistForm />
          </div>
        </section>
      </div>

      <footer className="relative z-10 border-t border-border/30 px-4 py-4">
        <p className="mx-auto max-w-3xl text-center text-[11px] leading-relaxed text-text-tertiary">
          By providing your email address, you consent to receive marketing communications
          from iTrader.im about our upcoming vehicle marketplace. You can unsubscribe at any
          time. We will not share your data with third parties. View our{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-secondary">
            Privacy Policy
          </a>.
        </p>
      </footer>
    </div>
  );
}
