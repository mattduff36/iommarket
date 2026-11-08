"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDealerStockSyncAvailability } from "@/lib/deployment/dealer-stock-sync";
import { recoverySchema } from "@/lib/dealer-stock-sync/apply-recovery";
import { recoverApprovedStock } from "@/lib/dealer-stock-sync/apply-recovery-store";

export async function recoverDealerStockReport(input: unknown) {
  const admin = await requireRole("ADMIN");
  const availability = getDealerStockSyncAvailability();
  if (!availability.enabled) return { error: availability.reason ?? "Stock review is unavailable." };
  const limited = await checkRateLimit(`dealer-stock-sync:${admin.id}`, { windowMs: 60_000, maxRequests: 20, policy: "dealer-stock-sync" });
  if (!limited.allowed) return { error: "Too many stock review requests. Try again shortly." };
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) return { error: "This recovery request is invalid. Refresh the saved review." };
  try {
    const result = await recoverApprovedStock(parsed.data, admin.id);
    if (result.data) {
      revalidatePath("/admin/stock-reviews");
      revalidatePath("/admin/dealers");
      revalidatePath(`/admin/dealers/${result.data.dealerId}/stock-sync`);
    }
    return result;
  } catch (error) {
    console.error("Stock report recovery failed.", { reportId: parsed.data.reportId, operation: parsed.data.operation, code: error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN" });
    return { error: "Recovery could not be confirmed. Refresh the results and check the current task before trying again." };
  }
}
