export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { DealerAccountPage } from "@/components/account/dealer-account-page";

export const metadata: Metadata = {
  title: "Email delivery",
  description: "Manage the dealer correspondence address on itrader.im.",
};

export default async function DealerEmailSettingsPage() {
  return DealerAccountPage({ section: "email", route: "/dealer/email-settings" });
}
