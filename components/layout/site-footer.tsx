import Link from "next/link";
import Image from "next/image";
import { FOOTER_NAV_ITEMS } from "@/lib/navigation";
import { CookiePreferencesButton } from "@/components/layout/cookie-banner";
import { COMPANY, getDataControllerReference } from "@/lib/policy/company";

export function SiteFooter() {
  const dataControllerReference = getDataControllerReference();
  const year = new Date().getFullYear();

  return (
    <footer className="bg-graphite-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="inline-flex items-center">
              <Image
                src="/images/logo-itrader-hq.png"
                alt="iTrader.im – Buy · Sell · Upgrade"
                width={180}
                height={60}
                className="h-10 w-auto opacity-90 hover:opacity-100 transition-opacity"
              />
            </Link>
            <p className="mt-2 max-w-xs text-sm text-metallic-400">
              The Isle of Man&apos;s trusted marketplace for cars, vans,
              motorbikes, and motorhomes.
            </p>
          </div>

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

        <div className="mt-10 border-t border-border pt-6 space-y-3">
          <p className="text-xs text-metallic-500">
            &copy; {year} {COMPANY.legalName}. All rights reserved.
          </p>
          <p className="text-xs text-metallic-500">
            Trading as {COMPANY.tradingAs}. Company number {COMPANY.companyNumber}.
            Registered office: {COMPANY.registeredOffice}. Email:{" "}
            <a
              href={`mailto:${COMPANY.email}`}
              className="hover:text-text-primary"
            >
              {COMPANY.email}
            </a>
            .
          </p>
          <p className="text-xs text-metallic-500">
            Isle of Man Data Controller Registration Ref: {dataControllerReference}
          </p>
          <p className="text-xs text-metallic-500">
            Created with care on the Isle of Man.{" "}
            <CookiePreferencesButton className="underline hover:text-text-primary" />
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
