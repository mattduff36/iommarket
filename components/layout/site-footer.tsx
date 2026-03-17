import Link from "next/link";
import Image from "next/image";
import { FOOTER_NAV_ITEMS } from "@/lib/navigation";

export function SiteFooter() {
  const dataControllerReference =
    process.env.NEXT_PUBLIC_IOM_DATA_CONTROLLER_REF ?? "Pending publication";

  return (
    <footer className="bg-graphite-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Top row */}
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center">
              <Image
                src="/images/logo-itrader.png"
                alt="iTrader.im – Buy · Sell · Upgrade"
                width={180}
                height={60}
                className="h-10 w-auto opacity-90 hover:opacity-100 transition-opacity"
              />
            </Link>
            <p className="mt-2 max-w-xs text-sm text-metallic-400">
              The Isle of Man&apos;s trusted marketplace for cars, vans,
              motorbikes and more.
            </p>
          </div>

          {/* Nav links */}
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Footer">
            {FOOTER_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-metallic-400 hover:text-text-primary transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Divider + copyright */}
        <div className="mt-10 border-t border-border pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs text-metallic-500">
              &copy; {new Date().getFullYear()} itrader.im. All rights reserved.
            </p>
            <p className="text-xs text-metallic-500">
              Isle of Man Data Controller Registration Ref: {dataControllerReference}
            </p>
          </div>
          <p className="text-xs text-metallic-500">Created with care on the Isle of Man</p>
        </div>
      </div>
    </footer>
  );
}
