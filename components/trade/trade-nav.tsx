import Link from "next/link";

const LINKS = [
  ["Browse", "/dealer/trade"],
  ["My stock", "/dealer/trade/stock"],
  ["New listing", "/dealer/trade/new"],
  ["Enquiries", "/dealer/trade/enquiries"],
  ["Saved searches", "/dealer/trade/saved"],
  ["Import", "/dealer/trade/import"],
] as const;

export function TradeNav() {
  return (
    <nav aria-label="Trade Exchange" className="mb-6 flex flex-wrap gap-2">
      {LINKS.map(([label, href]) => (
        <Link key={href} href={href} className="rounded-full border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-surface">
          {label}
        </Link>
      ))}
    </nav>
  );
}
