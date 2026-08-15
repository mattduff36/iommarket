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
      <h1 className="section-heading-accent text-2xl font-bold font-heading text-text-primary">
        Review and accept current policies
      </h1>
      <p className="mt-3 text-sm leading-6 text-text-secondary">
        Existing account holders must confirm they are 18 or over and acknowledge
        the current Terms, Acceptable Use Policy, and Privacy Policy before using
        account, seller, or dealer tools. Cookie preferences stay separate.
      </p>
      <div className="mt-6">
        <AcceptPoliciesForm />
      </div>
    </div>
  );
}
