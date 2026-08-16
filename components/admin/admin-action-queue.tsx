import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  Bug,
  Clock,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CardOverlayLink } from "@/components/ui/card-overlay-link";
import { cn } from "@/lib/cn";

export type AdminActionQueueTone = "warning" | "error";

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
  tone: AdminActionQueueTone;
};

const TONE_STYLES = {
  warning: {
    card: "border-premium-gold-500/30 bg-premium-gold-500/10 hover:border-premium-gold-500/50 hover:bg-premium-gold-500/15",
    icon: "border-premium-gold-500/25 bg-premium-gold-500/10 text-premium-gold-400",
    badge: "warning" as const,
  },
  error: {
    card: "border-neon-red-500/30 bg-neon-red-500/10 hover:border-neon-red-500/50 hover:bg-neon-red-500/15",
    icon: "border-neon-red-500/25 bg-neon-red-500/10 text-neon-red-400",
    badge: "error" as const,
  },
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
      tone: "warning",
    },
    {
      href: "/admin/reports",
      label: "Open reports",
      count: counts.openReports,
      subtitle: "Need attention",
      icon: AlertTriangle,
      tone: "error",
    },
    {
      href: "/admin/reviews",
      label: "Pending reviews",
      count: counts.pendingReviews,
      subtitle: "Awaiting moderation",
      icon: Star,
      tone: "warning",
    },
    {
      href: "/admin/cancellations",
      label: "Open cancellations",
      count: counts.openCancellations,
      subtitle: "Need staff action",
      icon: Ban,
      tone: "error",
    },
    {
      href: "/admin/monitoring?status=OPEN",
      label: "Open monitoring issues",
      count: counts.openMonitoringIssues,
      subtitle: "Open issues",
      icon: Bug,
      tone: "error",
    },
  ];
}

export function AdminActionQueue({ items }: { items: AdminActionQueueItem[] }) {
  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => {
        const Icon = item.icon;
        const needsAction = item.count > 0;
        const tone = TONE_STYLES[item.tone];

        return (
          <Card
            key={item.href}
            className={cn(
              "group relative min-h-24 transition-colors",
              needsAction ? tone.card : "border-border hover:bg-surface-elevated",
            )}
          >
            <CardOverlayLink
              href={item.href}
              label={`${item.count.toLocaleString()} ${item.label}`}
            />
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
                    needsAction
                      ? tone.icon
                      : "border-border bg-surface-elevated text-text-tertiary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <Badge
                  variant={needsAction ? tone.badge : "neutral"}
                  className="shrink-0 tabular-nums"
                >
                  {needsAction ? item.count.toLocaleString() : "Clear"}
                </Badge>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                <p className="mt-0.5 text-xs text-text-secondary">{item.subtitle}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
