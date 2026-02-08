import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface-subtle">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              IOM Market
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              The Isle of Man&apos;s trusted marketplace for high-value items.
            </p>
          </div>

          <nav className="flex flex-wrap gap-4 text-xs text-text-secondary" aria-label="Footer">
            <Link href="/pricing" className="hover:text-text-primary transition-colors">
              Pricing
            </Link>
            <Link href="/terms" className="hover:text-text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/contact" className="hover:text-text-primary transition-colors">
              Contact
            </Link>
          </nav>
        </div>

        <div className="mt-6 border-t border-border pt-4 text-center text-xs text-text-tertiary">
          &copy; {new Date().getFullYear()} IOM Market. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
