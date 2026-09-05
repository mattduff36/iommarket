"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getAccountNavItems, getRoleLabel, type AuthRole } from "@/lib/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Eye, ShieldCheck } from "lucide-react";
import {
  PreviewPacksControlList,
  usePreviewControls,
} from "@/components/auth/preview-packs-controls";

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

type FlyoutSide = "left" | "right" | "bottom";

const PREVIEW_FLYOUT_WIDTH = 288;

export function resolveFlyoutSide(trigger: HTMLElement | null): FlyoutSide {
  if (!trigger) return "left";
  const rect = trigger.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return "left";
  const spaceLeft = rect.left;
  const spaceRight = window.innerWidth - rect.right;
  if (spaceLeft >= PREVIEW_FLYOUT_WIDTH) return "left";
  if (spaceRight >= PREVIEW_FLYOUT_WIDTH) return "right";
  return "bottom";
}

export function HeaderAuthButtons({ authState }: Props) {
  const { user, displayName, role, loading, handleSignOut } = authState;
  const accountNavItems = getAccountNavItems(role);
  const previewControls = usePreviewControls();
  const isAdmin = role === "ADMIN";
  const previewTriggerRef = useRef<HTMLDivElement | null>(null);
  const [flyoutSide, setFlyoutSide] = useState<FlyoutSide>("left");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const updateFlyoutSide = useCallback(() => {
    setFlyoutSide(resolveFlyoutSide(previewTriggerRef.current));
  }, []);

  useEffect(() => {
    if (!accountMenuOpen || !isAdmin) return;
    updateFlyoutSide();
    window.addEventListener("resize", updateFlyoutSide);
    return () => window.removeEventListener("resize", updateFlyoutSide);
  }, [accountMenuOpen, isAdmin, updateFlyoutSide]);

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
        {/* Sign up is hidden on mobile - it moves to the burger menu */}
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
      <DropdownMenu
        open={accountMenuOpen}
        onOpenChange={(open) => {
          setAccountMenuOpen(open);
          if (open && isAdmin) {
            void previewControls.ensureLoaded();
            requestAnimationFrame(updateFlyoutSide);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex gap-1 h-auto py-1 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          >
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
        <DropdownMenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
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
                <DropdownMenuSub key="preview-packs">
                  <DropdownMenuSubTrigger
                    ref={previewTriggerRef}
                    chevron={flyoutSide === "bottom" ? "down" : flyoutSide}
                    className="!text-red-400 hover:!text-red-300 font-medium"
                  >
                    <Eye className="mr-2 h-4 w-4 shrink-0" />
                    Preview packs
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    side={flyoutSide === "bottom" ? "bottom" : flyoutSide}
                    align={flyoutSide === "bottom" ? "end" : "start"}
                    className="max-h-96 w-72 overflow-y-auto p-1"
                  >
                    <PreviewPacksControlList
                      asMenuItems
                      state={previewControls.state}
                      error={previewControls.error}
                      pendingKey={previewControls.pendingKey}
                      onTogglePack={(pack) => {
                        setAccountMenuOpen(false);
                        previewControls.togglePack(pack);
                      }}
                      onToggleSample={(kind) => {
                        setAccountMenuOpen(false);
                        previewControls.toggleSample(kind);
                      }}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>,
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
