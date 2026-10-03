import { notFound } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { requiresStagingAdmin } from "@/lib/deployment/staging-access-policy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Staging administrator access", robots: { index: false, follow: false } };

export default function StagingAccessPage() {
  if (!requiresStagingAdmin()) notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-12">
      <div className="text-center">
        <p className="mb-3 text-sm font-semibold text-text-brand">iTrader development</p>
        <h1 className="text-3xl font-bold">Administrator access</h1>
        <p className="mt-3 text-text-secondary">This is the private staging site. Sign in with your development administrator account.</p>
      </div>
      <SignInForm adminOnly />
    </main>
  );
}
