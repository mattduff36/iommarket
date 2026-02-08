import Link from "next/link";
import Image from "next/image";

const FOOTER_NAV = [
  { label: "Home", href: "/" },
  { label: "Categories", href: "/categories" },
  { label: "Pricing", href: "/pricing" },
  { label: "Sell", href: "/sell" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Contact", href: "/contact" },
];

export function SiteFooter() {
  return (
    <footer className="bg-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Top row */}
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5 text-xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
              <Image
                src="/images/iom-flag.png"
                alt="Isle of Man flag"
                width={28}
                height={17}
                className="rounded-[3px] opacity-90"
              />
              itrader.im
            </Link>
            <p className="mt-2 max-w-xs text-sm text-slate-400">
              The Isle of Man&apos;s trusted marketplace for vehicles, marine,
              hi-fi, instruments, and more.
            </p>
          </div>

          {/* Nav links */}
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Footer">
            {FOOTER_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-300 hover:text-white transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Divider + copyright */}
        <div className="mt-10 border-t border-slate-700 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} itrader.im. All rights reserved.
          </p>
          <p className="text-xs text-slate-500">
            Created with care on the Isle of Man
          </p>
        </div>
      </div>
    </footer>
  );
}
