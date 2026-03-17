export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing on itrader.im.",
};

export default async function SellPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/sell");
  if (user.role === "DEALER" || user.role === "ADMIN") {
    redirect("/sell/dealer");
  }
  redirect("/sell/private");
}
