export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getAdminStats } from "@/actions/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClipboardList,
  Clock,
  CheckCircle,
  Users,
  AlertTriangle,
  DollarSign,
} from "lucide-react";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminDashboardPage() {
  const stats = await getAdminStats();

  const cards = [
    {
      label: "Total Listings",
      value: stats.totalListings,
      icon: ClipboardList,
    },
    { label: "Pending Review", value: stats.pendingListings, icon: Clock },
    { label: "Live Listings", value: stats.liveListings, icon: CheckCircle },
    { label: "Dealers", value: stats.totalDealers, icon: Users },
    { label: "Open Reports", value: stats.openReports, icon: AlertTriangle },
    {
      label: "Payments (30d)",
      value: stats.recentPayments,
      icon: DollarSign,
    },
  ];

  return (
    <>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-text-secondary">
                {card.label}
              </CardTitle>
              <card.icon className="h-4 w-4 text-text-tertiary" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-text-primary">
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
