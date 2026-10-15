import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAcceptedUser } from "@/lib/policy/gate";
import { getSellFormData } from "../sell-form-data";
import { ListingPreviewClient } from "../listing-preview-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Private listing preview", robots: { index: false, follow: false } };

export default async function ListingPreviewPage() {
  const user = await requireAcceptedUser("/sell/preview");
  if (user.role === "ADMIN") redirect("/admin/listings");
  const { categories, regions } = await getSellFormData();
  return <ListingPreviewClient userId={user.id} mode={user.role === "DEALER" ? "dealer" : "private"} categories={categories} regions={regions} />;
}
