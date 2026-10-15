import type { ReactNode } from "react";
import Link from "next/link";
import type { TradeListingStatus, TradeMembershipStatus, TradeReportStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MEMBERSHIP_STATUS: Record<TradeMembershipStatus, { label: string; variant: "warning" | "info" | "success" | "error" }> = {
  PENDING: { label: "Waiting", variant: "warning" },
  NEEDS_INFO: { label: "Needs information", variant: "info" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "error" },
  SUSPENDED: { label: "Suspended", variant: "warning" },
  REVOKED: { label: "Revoked", variant: "error" },
};

const LISTING_STATUS: Record<TradeListingStatus, { label: string; variant: "neutral" | "warning" | "success" | "info" | "error" }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  PENDING_REVIEW: { label: "Pending review", variant: "warning" },
  LIVE: { label: "Live", variant: "success" },
  RESERVED: { label: "Reserved", variant: "info" },
  SOLD: { label: "Sold", variant: "neutral" },
  WITHDRAWN: { label: "Withdrawn", variant: "neutral" },
  EXPIRED: { label: "Expired", variant: "warning" },
  REMOVED: { label: "Removed", variant: "error" },
};

const REPORT_STATUS: Record<TradeReportStatus, { label: string; variant: "warning" | "success" | "neutral" }> = {
  OPEN: { label: "Open", variant: "warning" },
  RESOLVED: { label: "Resolved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "neutral" },
};

export const TRADE_MEMBERSHIP_FILTERS = [
  "PENDING",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "REVOKED",
] as const satisfies readonly TradeMembershipStatus[];

export const TRADE_DECISION_OPTIONS = [
  { value: "APPROVED", label: "Approve" },
  { value: "NEEDS_INFO", label: "Needs information" },
  { value: "REJECTED", label: "Reject" },
  { value: "SUSPENDED", label: "Suspend" },
  { value: "REVOKED", label: "Revoke" },
] as const;

const ENTITY_LABELS = {
  REGISTERED_COMPANY: "Registered company",
  REGISTERED_BUSINESS_NAME: "Registered business name",
  SOLE_TRADER_OR_PARTNERSHIP: "Sole trader or partnership",
  OTHER: "Other",
} as const;

export function tradeCodeLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function tradeEntityLabel(value: string) {
  return value in ENTITY_LABELS ? ENTITY_LABELS[value as keyof typeof ENTITY_LABELS] : tradeCodeLabel(value);
}

export function tradeMembershipLabel(status: TradeMembershipStatus) {
  return MEMBERSHIP_STATUS[status].label;
}

export function TradeMembershipBadge({ status }: { status: TradeMembershipStatus }) {
  const item = MEMBERSHIP_STATUS[status];
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

export function TradeListingBadge({ status }: { status: TradeListingStatus }) {
  const item = LISTING_STATUS[status];
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

export function TradeReportBadge({ status }: { status: TradeReportStatus }) {
  const item = REPORT_STATUS[status];
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

export function TradeBackLink({ href, children }: { href: string; children: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

export function TradeSectionLinks() {
  const links = [
    ["Applications", "/admin/trade/applications"],
    ["Listings", "/admin/trade/listings"],
    ["Reports", "/admin/trade/reports"],
  ] as const;
  return (
    <nav aria-label="Trade sections" className="flex flex-wrap gap-2">
      {links.map(([label, href]) => (
        <Button key={href} asChild variant="ghost" size="sm">
          <Link href={href}>{label}</Link>
        </Button>
      ))}
    </nav>
  );
}

export function TradeMetricStrip({ items }: { items: { label: string; value: number }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-border bg-surface px-4 py-3">
          <dt className="text-xs leading-5 text-text-secondary">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
            {item.value.toLocaleString("en-GB")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TradeReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-base font-semibold tracking-[-0.02em] text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function TradeFactList({ items }: { items: { label: string; value: ReactNode }[] }) {
  const visible = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (visible.length === 0) return <p className="text-sm text-text-secondary">Nothing recorded.</p>;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {visible.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs leading-5 text-text-secondary">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm leading-6 text-text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TradeAccessFacts({
  verified,
  status,
  proActive,
}: {
  verified: boolean;
  status: TradeMembershipStatus;
  proActive: boolean;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-surface p-3">
        <dt className="text-xs leading-5 text-text-secondary">Public verified badge</dt>
        <dd className="mt-2"><Badge variant={verified ? "success" : "neutral"}>{verified ? "Shown" : "Not shown"}</Badge></dd>
        <p className="mt-2 text-xs leading-5 text-text-secondary">The public dealer badge. Trade approval does not change it.</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <dt className="text-xs leading-5 text-text-secondary">Trade approval</dt>
        <dd className="mt-2"><TradeMembershipBadge status={status} /></dd>
        <p className="mt-2 text-xs leading-5 text-text-secondary">Membership decision for Trade Exchange only.</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-3">
        <dt className="text-xs leading-5 text-text-secondary">Active Pro</dt>
        <dd className="mt-2"><Badge variant={proActive ? "success" : "warning"}>{proActive ? "Active" : "Required"}</Badge></dd>
        <p className="mt-2 text-xs leading-5 text-text-secondary">Trading needs this approval and an active Pro plan.</p>
      </div>
    </dl>
  );
}
