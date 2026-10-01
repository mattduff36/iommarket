import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HoldingHeader() {
  return (
    <>
      <div className="hidden bg-graphite-950 text-text-secondary sm:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4 text-xs sm:px-6 lg:px-8">
          <a
            href="mailto:hello@itrader.im"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-neon-blue-400"
          >
            <Mail className="h-3 w-3" />
            <span>hello@itrader.im</span>
          </a>
          <span className="text-xs text-metallic-400">
            The Isle of Man&apos;s Trusted Vehicle Marketplace
          </span>
        </div>
      </div>
      <header className="sticky top-0 z-40 h-16 w-full border-b border-neon-blue-500/40 glass-surface sm:h-20">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center">
            <Image
              src="/images/logo-itrader-hq.png"
              alt="iTrader.im – Buy · Sell · Upgrade"
              width={220}
              height={74}
              className="h-9 w-auto sm:h-12"
              priority
            />
          </Link>
          <Button asChild variant="trust" size="sm">
            <Link href="/sign-in">Sign In</Link>
          </Button>
        </div>
      </header>
    </>
  );
}
