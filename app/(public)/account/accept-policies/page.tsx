import { AdminPageHeader } from "@/components/admin/admin-page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AcceptPoliciesForm } from "./accept-policies-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept policies",
  description: "Confirm you are 18 or over and acknowledge the current iTrader.im policies.",
};

export default async function AcceptPoliciesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/account/accept-policies");

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 lg:px-8">
      <AdminPageHeader title="Review and accept current policies"
          description="Existing account holders must confirm they are 18 or over and acknowledge the current Terms, Acceptable Use Policy, and Privacy Policy before using account, seller, or dealer tools. Cookie preferences stay separate." />
      <div className="mt-6">
        <AcceptPoliciesForm />
      </div>
    </div>
  );
}
