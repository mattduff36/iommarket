"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ShieldCheck } from "lucide-react";

export function HeaderAuthButtons() {
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string | null } | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        fetch("/api/me", { credentials: "same-origin" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (data?.role) setRole(data.role); })
          .catch(() => {});
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setRole(null);
      } else {
        fetch("/api/me", { credentials: "same-origin" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (data?.role) setRole(data.role); })
          .catch(() => {});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <Button variant="ghost" size="sm" disabled>
        …
      </Button>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <Button asChild variant="link" size="sm">
          <Link href="/sign-up">Sign Up</Link>
        </Button>
        <Button asChild variant="trust" size="sm">
          <Link href="/sign-in">Sign In</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          <span className="max-w-[120px] truncate sm:max-w-[180px]">
            {user.email ?? "Account"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {role === "ADMIN" && (
          <>
            <DropdownMenuItem asChild className="!text-red-400 hover:!text-red-300">
              <Link href="/admin" className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Admin area
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/account/favourites">Saved listings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/saved-searches">Saved searches</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dealer/dashboard">Dealer dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/change-password">Change password</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
