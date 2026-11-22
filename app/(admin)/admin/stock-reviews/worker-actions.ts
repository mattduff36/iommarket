"use server";

import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { desktopAccountEnabled } from "@/lib/dealer-stock-sync/desktop-config";
import {
  commandWorkerDevice,
  createWorkerControlDependencies,
  readWorkerDashboard,
  type WorkerCommandResult,
  type WorkerDashboardResult,
} from "@/lib/dealer-stock-sync/worker-control";

export async function getWorkerDashboard(): Promise<WorkerDashboardResult> {
  noStore();
  const admin = await requireRole("ADMIN");
  if (!desktopAccountEnabled(process.env, admin.id)) return { ok: false, error: "unavailable" };
  return readWorkerDashboard(createWorkerControlDependencies(), admin.id);
}

export async function commandWorker(input: {
  deviceId: string;
  instanceId: string;
  action: "start" | "stop" | "close";
}): Promise<WorkerCommandResult> {
  noStore();
  const admin = await requireRole("ADMIN");
  const headerList = await headers();
  return commandWorkerDevice(createWorkerControlDependencies(), {
    adminId: admin.id,
    origin: headerList.get("origin"),
    host: headerList.get("host"),
    forwardedHost: headerList.get("x-forwarded-host"),
    body: input,
  });
}
