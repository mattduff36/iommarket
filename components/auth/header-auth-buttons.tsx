"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getAccountNavItems, getRoleLabel, type AuthRole } from "@/lib/navigation";
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
  role: AuthRole;
  loading: boolean;
  handleSignOut: () => Promise<void>;
}

interface Props {
  authState: AuthState;
}

export function HeaderAuthButtons({ authState }: Props) {
  const { user, displayName, role, loading, handleSignOut } = authState;
  const accountNavItems = getAccountNavItems(role);

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
        {/* Sign up is hidden on mobile — it moves to the burger menu */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden border border-neon-blue-500 bg-transparent font-bold uppercase italic text-neon-blue-500 hover:bg-neon-blue-500/10 hover:text-neon-blue-400 md:inline-flex"
        >
          <Link href="/sign-up">Sign Up</Link>
        </Button>
        <Button asChild variant="trust" size="sm">
          <Link href="/sign-in">Sign In</Link>
        </Button>
      </div>
    );
  }

  const roleLabel = getRoleLabel(role) ?? "Member";

  return (
    <>
      {/* Mobile: plain non-clickable label (no dropdown) */}
      <div className="md:hidden flex flex-col items-end">
        <span className="max-w-[140px] truncate text-sm font-medium text-text-secondary">
          {displayName ?? user.email ?? "Account"}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {roleLabel}
        </span>
      </div>

      {/* Desktop: full dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex gap-1 h-auto py-1">
            <span className="flex flex-col items-end leading-tight">
              <span className="max-w-[180px] truncate">
                {displayName ?? user.email ?? "Account"}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-normal">
                {roleLabel}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {accountNavItems.map((item) =>
            item.href === "/admin" ? (
              [
                <DropdownMenuSeparator key={`${item.href}-separator`} />,
                <DropdownMenuItem
                  key={item.href}
                  asChild
                  className="!text-red-400 hover:!text-red-300"
                >
                  <Link href={item.href} className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </DropdownMenuItem>,
              ]
            ) : (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>{item.label}</Link>
              </DropdownMenuItem>
            )
          )}
          <DropdownMenuItem onClick={handleSignOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
