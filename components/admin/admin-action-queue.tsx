import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Bug,
  Clock,
  Star,
} from "lucide-react";
import { NAVIGABLE_CARD_LINK_CLASS } from "@/components/ui/card-overlay-link";
import { cn } from "@/lib/cn";

export type AdminActionQueueCounts = {
  listingsAwaitingReview: number;
  openReports: number;
  pendingReviews: number;
  openCancellations: number;
  openMonitoringIssues: number;
};

export type AdminActionQueueItem = {
  href: string;
  label: string;
  count: number;
  subtitle: string;
  icon: LucideIcon;
};

export function buildAdminActionQueueItems(
  counts: AdminActionQueueCounts,
): AdminActionQueueItem[] {
  return [
    {
      href: "/admin/listings?status=PENDING",
      label: "Listings awaiting review",
      count: counts.listingsAwaitingReview,
      subtitle: "New listings and pending edits",
      icon: Clock,
    },
    {
      href: "/admin/reports",
      label: "Open reports",
      count: counts.openReports,
      subtitle: "Need attention",
      icon: AlertTriangle,
    },
    {
      href: "/admin/reviews",
      label: "Pending reviews",
      count: counts.pendingReviews,
      subtitle: "Awaiting moderation",
      icon: Star,
    },
    {
      href: "/admin/cancellations",
      label: "Open cancellations",
      count: counts.openCancellations,
      subtitle: "Need staff action",
      icon: Ban,
    },
    {
      href: "/admin/monitoring?status=OPEN",
      label: "Open monitoring issues",
      count: counts.openMonitoringIssues,
      subtitle: "Open issues",
      icon: Bug,
    },
  ];
}

export function AdminActionQueue({ items }: { items: AdminActionQueueItem[] }) {
  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => {
        const Icon = item.icon;
        const needsAction = item.count > 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group flex items-center gap-3 rounded-lg border bg-surface p-4 transition-all hover:bg-surface-elevated",
              needsAction
                ? "border-neon-red-500/20 hover:border-neon-red-500/40"
                : "border-border hover:border-border",
              NAVIGABLE_CARD_LINK_CLASS,
            )}
          >
            <div
              className={cn(
                "rounded-md p-2",
                needsAction ? "bg-neon-red-500/10" : "bg-surface-elevated",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  needsAction ? "text-neon-red-400" : "text-text-tertiary",
                )}
              />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">
                {item.count.toLocaleString()} {item.label}
              </p>
              <p className="text-xs text-text-tertiary">{item.subtitle}</p>
            </div>
            <ArrowRight className="ml-auto h-4 w-4 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        );
      })}
    </div>
  );
}
