"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ShieldCheck } from "lucide-react";

export interface AuthState {
  user: { email?: string | null } | null;
  displayName: string | null;
  role: string | null;
  loading: boolean;
  handleSignOut: () => Promise<void>;
}

interface Props {
  authState: AuthState;
}

export function HeaderAuthButtons({ authState }: Props) {
  const { user, displayName, role, loading, handleSignOut } = authState;

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
        {/* Sign Up is hidden on mobile — it moves to the burger menu */}
        <Button asChild variant="link" size="sm" className="hidden md:inline-flex">
          <Link href="/sign-up">Sign Up</Link>
        </Button>
        <Button asChild variant="trust" size="sm">
          <Link href="/sign-in">Sign In</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: plain non-clickable label (no dropdown) */}
      <span className="md:hidden max-w-[140px] truncate text-sm font-medium text-text-secondary">
        {displayName ?? user.email ?? "Account"}
      </span>

      {/* Desktop: full dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex gap-1">
            <span className="max-w-[180px] truncate">
              {displayName ?? user.email ?? "Account"}
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
    </>
  );
}
