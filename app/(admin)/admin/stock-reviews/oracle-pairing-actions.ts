"use server";

import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { browserOriginAllowed } from "@/lib/dealer-stock-sync/desktop-config";
import { liveDesktopDependencies } from "@/lib/dealer-stock-sync/desktop-service";
import { oracleDeployment, oracleProfiles } from "@/lib/dealer-stock-sync/oracle-pairing-config";
import { oraclePairingStore } from "@/lib/dealer-stock-sync/oracle-pairing";

async function currentOracleProfile(requireOrigin: boolean) {
  const admin = await requireRole("ADMIN");
  const request = await headers();
  const host = request.get("host"), forwarded = request.get("x-forwarded-host");
  const deployment = oracleDeployment(process.env);
  if (!deployment || (forwarded ?? host)?.split(",")[0].trim() !== new URL(deployment.origin).host) return undefined;
  if (requireOrigin && !browserOriginAllowed(request.get("origin"), host, forwarded, deployment.origin)) return undefined;
  return oracleProfiles(process.env, deployment).find(p => p.adminId === admin.id);
}

export async function getOraclePairingState(): Promise<{ status: "available" | "offline" | "disabled" }> {
  const profile = await currentOracleProfile(false);
  if (!profile) return { status: "disabled" };
  try { return { status: await oraclePairingStore(profile).available() ? "available" : "offline" }; }
  catch { return { status: "offline" }; }
}

export async function requestOraclePairing(): Promise<{ code: string } | { error: string }> {
  const profile = await currentOracleProfile(true);
  if (!profile) return { error: "Oracle pairing is unavailable for this account." };
  try {
    const deps = liveDesktopDependencies();
    const devices = await deps.store.listDevices(profile.adminId);
    if (devices.some(d => d.environment === process.env.VERCEL_ENV && d.adminId === profile.adminId && d.scopedVm &&
      Date.parse(d.expiresAt) > deps.now())) return { error: "An Oracle VM is already linked to this account." };
    return await oraclePairingStore(profile).invitation();
  } catch { return { error: "Oracle pairing is unavailable. Please try again shortly." }; }
}
