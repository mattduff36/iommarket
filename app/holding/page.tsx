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
      className="relative min-h-screen"
      style={{ background: HERO_GRADIENT }}
    >
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-12 text-center sm:px-6 sm:py-16 lg:py-24">
        <Image
          src="/images/logo-itrader.png"
          alt="iTrader.im – Buy · Sell · Upgrade"
          width={480}
          height={160}
          priority
          className="w-auto max-w-[280px] sm:max-w-[360px] drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
        />

        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-neon-blue-400">
          Coming Soon
        </p>
        <h1 className="mt-3 font-heading text-3xl font-bold text-text-primary sm:text-4xl lg:text-5xl">
          Isle of Man&apos;s Dedicated Vehicle Marketplace
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-metallic-300">
          A trusted local platform to buy and sell cars, vans and motorcycles.
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-base text-text-secondary">
          We&apos;re building a better marketplace for vehicles on the Isle of Man.
          Join the waiting list to be notified when we launch.
        </p>

        <section className="mt-10 w-full max-w-xl rounded-xl border border-border bg-surface/80 p-5 text-left shadow-high backdrop-blur sm:p-6">
          <h2 className="text-xl font-semibold text-text-primary">Join the Waiting List</h2>
          <p className="mt-2 text-sm text-text-secondary">
            Be first to know when iTrader.im opens to the island.
          </p>
          <div className="mt-5">
            <WaitlistForm />
          </div>
        </section>
      </div>
    </div>
  );
}
