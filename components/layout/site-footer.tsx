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
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6 md:items-center">
          <div className="flex items-center gap-3 md:col-span-1 md:flex-col md:items-start md:gap-0">
            <Link href="/" className="inline-flex shrink-0 items-center">
              <Image
                src="/images/logo-itrader-hq.png"
                alt="iTrader.im – Buy · Sell · Upgrade"
                width={180}
                height={60}
                className="h-10 w-auto opacity-90 hover:opacity-100 transition-opacity"
              />
            </Link>
            <p className="min-w-0 text-sm leading-snug text-metallic-500 md:mt-1">
              The Isle of Man&apos;s trusted marketplace for cars, vans,
              motorbikes, and motorhomes.
            </p>
          </div>

          <nav
            className="flex flex-wrap justify-center gap-x-4 gap-y-0 text-center text-sm leading-snug md:col-span-2"
            aria-label="Footer"
          >
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

          <div className="text-left text-xs leading-snug text-metallic-500 md:col-span-3 md:text-right">
            <p>
              &copy; {year} {COMPANY.legalName}. All rights reserved.
            </p>
            <p>
              {COMPANY.tradingAs} is a trading name of {COMPANY.legalName}, a
              company registered in the Isle of Man under company number{" "}
              {COMPANY.companyNumber}.
            </p>
            <p>
              <a
                href={`mailto:${COMPANY.email}`}
                className="hover:text-text-primary"
              >
                {COMPANY.email}
              </a>
            </p>
            {dataControllerReference ? (
              <p>
                Isle of Man Data Controller Registration Ref:{" "}
                {dataControllerReference}
              </p>
            ) : null}
            <p>
              Created with care on the Isle of Man.{" "}
              <CookiePreferencesButton className="underline hover:text-text-primary" />
              .
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
