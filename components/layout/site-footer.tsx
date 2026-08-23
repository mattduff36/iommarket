import Link from "next/link";
import Image from "next/image";
import { FOOTER_NAV_ITEMS } from "@/lib/navigation";
import { CookiePreferencesButton } from "@/components/layout/cookie-banner";
import { FooterNav } from "@/components/layout/footer-nav";
import { COMPANY, getDataControllerReference } from "@/lib/policy/company";

export function SiteFooter() {
  const dataControllerReference = getDataControllerReference();
  const year = new Date().getFullYear();

  return (
    <footer className="bg-graphite-950">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,17fr)_minmax(0,47fr)_minmax(0,37fr)] md:items-center">
          <div className="flex items-center gap-3 md:flex-col md:items-center md:justify-center md:gap-2">
            <Link href="/" className="inline-flex shrink-0 items-center">
              <Image
                src="/images/logo-itrader-hq.png"
                alt="iTrader.im – Buy · Sell · Upgrade"
                width={180}
                height={60}
                className="h-10 w-auto opacity-90 hover:opacity-100 transition-opacity"
              />
            </Link>
            <p className="min-w-0 flex-1 self-stretch text-center text-[11px] leading-snug text-metallic-500">
              The Isle of Man&apos;s trusted marketplace for cars, vans,
              motorbikes, and motorhomes.
            </p>
          </div>

          <FooterNav items={FOOTER_NAV_ITEMS} className="hidden md:flex" />

          <div className="text-left text-xs leading-snug text-metallic-500 md:text-right">
            <div>
              <p>
                &copy; {year} {COMPANY.legalName}. All rights reserved.
              </p>
              <p>
                {COMPANY.tradingAs} is a trading name of {COMPANY.legalName}, a
                company registered in the Isle of Man under company number{" "}
                {COMPANY.companyNumber}.
              </p>
            </div>
            <div className="mt-2">
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
      </div>
    </footer>
  );
}
