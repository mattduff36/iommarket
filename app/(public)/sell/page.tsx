export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { getSellLandingPath } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing on itrader.im.",
};

export default async function SellPage() {
  const user = await requireAcceptedUser("/sell");
  if (user.role === "ADMIN") redirect("/admin/listings");
  redirect(getSellLandingPath(user.role) ?? "/sell/private");
}
