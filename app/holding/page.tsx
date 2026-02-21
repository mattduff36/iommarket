import Image from "next/image";
import type { Metadata } from "next";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";

export const metadata: Metadata = {
  title: "Isle of Man Marketplace",
  description: "Coming soon.",
};

export default function HoldingPage() {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center"
      style={{ background: HERO_GRADIENT }}
    >
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-4 text-center">
        {/* Logo */}
        <Image
          src="/images/logo-itrader.png"
          alt="iTrader.im – Buy · Sell · Upgrade"
          width={480}
          height={160}
          priority
          className="w-auto max-w-[300px] sm:max-w-[400px] drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
        />

        {/* Coming soon */}
        <p className="mt-6 font-heading text-4xl font-bold text-text-primary sm:text-5xl lg:text-6xl">
          Coming soon
        </p>
      </div>
    </div>
  );
}
