import type { LucideIcon } from "lucide-react";
import {
  CheckCircle,
  DollarSign,
  Eye,
  FileText,
  Heart,
  MapPin,
  Store,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  liveListings: number;
  totalListings: number;
  totalRevenue: number;
  recentPayments: number;
  totalDealers: number;
  verifiedDealers: number;
  views7d: number;
  totalFavourites: number;
  totalRegions: number;
  contentPages: number;
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
      value: input.liveListings.toLocaleString(),
      hint: `${input.totalListings} total`,
      icon: CheckCircle,
      iconClassName: "text-emerald-500/60",
    },
    {
      label: "Revenue",
      value: `£${input.totalRevenue.toLocaleString()}`,
      hint: `${input.recentPayments} payments (30d)`,
      icon: DollarSign,
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
    {
      label: "Views (7d)",
      value: input.views7d.toLocaleString(),
      icon: Eye,
      iconClassName: "text-premium-gold-400/60",
    },
    {
      label: "Favourites",
      value: input.totalFavourites.toLocaleString(),
      icon: Heart,
      iconClassName: "text-neon-red-400/60",
    },
    {
      label: "Regions",
      value: String(input.totalRegions),
      icon: MapPin,
      iconClassName: "text-emerald-500/60",
    },
    {
      label: "CMS Pages",
      value: String(input.contentPages),
      icon: FileText,
      iconClassName: "text-text-tertiary/60",
    },
  ];
}

export function AdminDashboardStats({ stats }: { stats: AdminDashboardStat[] }) {
  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;

        return (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-text-tertiary">
                {stat.label}
              </CardTitle>
              <Icon className={`h-3.5 w-3.5 ${stat.iconClassName}`} />
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold text-text-primary">{stat.value}</p>
              {stat.hint ? (
                <p className={`text-[11px] ${stat.hintClassName ?? "text-text-tertiary"}`}>
                  {stat.hint}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
