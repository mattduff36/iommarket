"use server";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { liveLaunchDependencies, mintDesktopLaunch, type LaunchResult } from "@/lib/dealer-stock-sync/desktop-launch";

export async function launchStockApp(input: { mode: "open" | "task"; jobIds?: string[] }): Promise<LaunchResult> {
  const admin = await requireRole("ADMIN");
  const requestHeaders = await headers();
  try {
    return await mintDesktopLaunch(liveLaunchDependencies(), { adminId: admin.id,
      origin: requestHeaders.get("origin"), host: requestHeaders.get("host"),
      forwardedHost: requestHeaders.get("x-forwarded-host"), body: input });
  } catch { return { ok: false, error: "Stock Update is temporarily unavailable. Try again shortly." }; }
}
