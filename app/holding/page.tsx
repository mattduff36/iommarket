import Image from "next/image";
import type { Metadata } from "next";
import { HERO_GRADIENT } from "@/lib/brand/hero-gradient";
import { CookieBanner } from "@/components/layout/cookie-banner";
import { HoldingHeader } from "@/components/layout/holding-header";
import { LaunchCountdown } from "@/components/holding/launch-countdown";
import { holdingCountdownTarget, PREVIEW_GATE_OPENS_AT } from "@/lib/launch/preview-rehearsal";
import styles from "./holding.module.css";

export const metadata: Metadata = {
  title: "Launching Saturday 3 October",
  description: "iTrader.im launches Saturday 3 October 2026 at 10:00 BST. The Isle of Man's dedicated vehicle marketplace. Buy, sell and upgrade locally.",
};

export default function HoldingPage() {
  const countdown = holdingCountdownTarget();
  const previewRehearsal = countdown.opensAt === PREVIEW_GATE_OPENS_AT;

  return (
    <div
      className="relative flex min-h-screen flex-col"
      style={{ background: HERO_GRADIENT }}
    >
      <HoldingHeader />
      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
        <Image
          src="/images/logo-itrader-hq.png"
          alt="iTrader.im – Buy · Sell · Upgrade"
          width={480}
          height={160}
          priority
          className="w-auto max-w-[260px] sm:max-w-[340px] drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
        />

        <div className={styles.badge}>
          <span className={styles.dot} aria-hidden="true" />
          <span>{previewRehearsal ? "Opening tonight" : "Launching this Saturday"}</span>
          <span className={styles.dot} aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-center font-heading font-bold leading-tight text-text-primary">
          <span className="block text-2xl sm:text-3xl lg:text-4xl">
            The Isle of Man&apos;s
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

        <p className="mt-8 text-center font-heading text-sm font-semibold text-text-primary sm:text-base">
          <time dateTime={previewRehearsal ? "2026-10-02T22:23:00+01:00" : "2026-10-03T10:00:00+01:00"}>
            {previewRehearsal ? "Friday 2 October" : "Saturday 3 October"}{" "}
            <span className="whitespace-nowrap text-[#ff714a]">
              {previewRehearsal ? "· 22:23 BST" : "· 10:00 BST"}
            </span>
          </time>
        </p>
        <LaunchCountdown opensAt={countdown.opensAt} releaseOnZero={countdown.releaseOnZero} />
        <p className="mt-2 text-center text-sm text-metallic-300">
          The wait is almost over. Be here for the start.
        </p>
        <div className={styles.divider} />
      </main>

      <footer className="relative z-10 border-t border-border/30 px-4 py-4">
        <p className="mx-auto max-w-3xl text-center text-[11px] leading-relaxed text-text-tertiary">
          iTrader.im · Buy · Sell · Upgrade
          <br />
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-secondary">
            Privacy Policy
          </a>
          {" · "}
          <a href="/cookies" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-secondary">
            Cookie Policy
          </a>.
        </p>
      </footer>
      <CookieBanner />
    </div>
  );
}
