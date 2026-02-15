import Link from "next/link";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Button } from "@/components/ui/button";

export default function SignInPage() {
  if (!isSupabaseAuthConfigured()) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground text-center">
          Sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to enable authentication.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-text-primary">Sign in</h1>
      <SignInForm />
      <div className="mt-6">
        <Button asChild variant="link" size="sm">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
