export function stockStatusColour(status: string) {
  const value = status.toLowerCase();
  if (["failed", "blocked", "unpublish"].includes(value)) return "border-red-500/40 bg-red-500/10 text-red-300";
  if (["applied", "succeeded", "pending_review", "no_change", "noop"].includes(value)) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  return "border-amber-500/40 bg-amber-500/10 text-amber-300";
}
export const STOCK_STATUS_BADGE = "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold";
