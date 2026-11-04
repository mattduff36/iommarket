import type { LucideIcon } from "lucide-react";
import {
  CheckCircle,
  PoundSterling,
  Store,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import styles from "./admin-dashboard-overview.module.css";

export type AdminDashboardStat = {
  label: string;
  value: string;
  hint?: string;
  hintClassName?: string;
  icon: LucideIcon;
  iconClassName: string;
};

export type AdminDashboardStatsInput = {
  totalUsers: number;
  newUsers7d: number;
  livePrivateListings: number;
  liveDealerListings: number;
  totalRevenue: number;
  recentPayments: number;
  totalDealers: number;
  verifiedDealers: number;
};

export function buildAdminDashboardStats(
  input: AdminDashboardStatsInput,
): AdminDashboardStat[] {
  return [
    {
      label: "Total Users",
      value: input.totalUsers.toLocaleString(),
      hint: `+${input.newUsers7d} this week`,
      hintClassName: "text-neon-blue-400",
      icon: Users,
      iconClassName: "text-neon-blue-400/60",
    },
    {
      label: "Live Listings",
      value: (input.livePrivateListings + input.liveDealerListings).toLocaleString("en-GB"),
      hint: `Private: ${input.livePrivateListings.toLocaleString("en-GB")} · Dealer: ${input.liveDealerListings.toLocaleString("en-GB")}`,
      icon: CheckCircle,
      iconClassName: "text-emerald-500/60",
    },
    {
      label: "Revenue",
      value: `£${input.totalRevenue.toLocaleString()}`,
      hint: `${input.recentPayments} payments (30d)`,
      icon: PoundSterling,
      iconClassName: "text-premium-gold-400/60",
    },
    {
      label: "Dealers",
      value: String(input.totalDealers),
      hint: `${input.verifiedDealers} verified`,
      hintClassName: "text-emerald-500",
      icon: Store,
      iconClassName: "text-neon-blue-400/60",
    },
  ];
}

export function AdminDashboardStats({ stats, compact = false }: { stats: AdminDashboardStat[]; compact?: boolean }) {
  if (compact) {
    return (
      <dl className={styles.metrics}>
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-3">
              <dt className="flex items-center justify-between gap-2 text-xs font-medium text-text-secondary">
                {stat.label}
                <Icon aria-hidden="true" className={`hidden h-4 w-4 shrink-0 sm:block ${stat.iconClassName}`} />
              </dt>
              <dd className="flex flex-col gap-2">
                <span className="text-2xl font-bold tracking-[-0.02em] tabular-nums text-text-primary">{stat.value}</span>
                {stat.hint ? <span className={`text-xs ${stat.hintClassName ?? "text-text-tertiary"}`}>{stat.hint}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader className="border-b border-border/70 px-4 py-3.5 sm:px-5">
        <CardTitle className="text-sm font-semibold">Marketplace overview</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 p-0 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;

          return (
            <div
              key={stat.label}
              className={cn(
                "flex min-h-28 flex-col justify-between gap-2 px-4 py-4 sm:px-5",
                "odd:border-r odd:border-border/70",
                index < 2 && "border-b border-border/70 lg:border-b-0",
                index < stats.length - 1 && "lg:border-r lg:border-border/70",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-secondary">{stat.label}</p>
                <Icon
                  aria-hidden="true"
                  className={`h-4 w-4 ${stat.iconClassName}`}
                />
              </div>
              <p className="text-2xl font-bold tracking-[-0.02em] tabular-nums text-text-primary">
                {stat.value}
              </p>
              {stat.hint ? (
                <p className={`text-xs ${stat.hintClassName ?? "text-text-tertiary"}`}>
                  {stat.hint}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
