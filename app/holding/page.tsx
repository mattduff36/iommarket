import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Isle of Man Marketplace",
  description: "Coming soon.",
};

export default function HoldingPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-900">
      {/* Background hero image */}
      <Image
        src="/images/hero-calf-of-man.png"
        alt=""
        fill
        priority
        className="object-cover opacity-40"
        sizes="100vw"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-4 text-center">
        {/* Flag logo */}
        <Image
          src="/images/iom-flag.png"
          alt="Isle of Man"
          width={64}
          height={40}
          className="rounded shadow-lg"
          priority
        />

        {/* Title */}
        <h1 className="mt-6 text-sm font-semibold uppercase tracking-[0.25em] text-royal-300 sm:text-base">
          Isle of Man Marketplace
        </h1>

        {/* Coming soon */}
        <p className="mt-6 font-display text-4xl font-bold text-white sm:text-5xl lg:text-6xl">
          Coming soon
        </p>
      </div>
    </div>
  );
}
