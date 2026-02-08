"use client";

import { ClerkProvider as BaseClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/auth/clerk-config";

/**
 * Wraps Clerk's provider. When no valid publishable key is present
 * (local dev without Clerk, CI builds), renders children without
 * Clerk so the app still works.
 */
export function ClerkProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isClerkConfigured()) {
    return <>{children}</>;
  }

  return <BaseClerkProvider>{children}</BaseClerkProvider>;
}
