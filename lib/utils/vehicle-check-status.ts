export type VehicleStatusTone = "success" | "error" | "warning" | "neutral";

export const vehicleStatusClasses: Record<VehicleStatusTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10",
  error: "border-neon-red-500/30 bg-neon-red-500/10",
  warning: "border-yellow-500/30 bg-yellow-500/10",
  neutral: "border-border bg-canvas/40",
};

export function getStatusVariant(
  value: string | null | undefined,
): VehicleStatusTone {
  const status = value?.trim().toLowerCase();
  if (
    [
      "untaxed",
      "not taxed",
      "not valid",
      "invalid",
      "expired",
      "inactive",
      "fail",
      "failed",
    ].includes(status ?? "")
  )
    return "error";
  if (["sorn", "due soon", "due", "expiring"].includes(status ?? ""))
    return "warning";
  if (["taxed", "valid", "active", "pass", "passed"].includes(status ?? ""))
    return "success";
  return "neutral";
}

// Compare calendar dates in the source's UK timezone, including the full due day.
export function getDueDateVariant(
  value: string | null | undefined,
  checkedAt: string,
): VehicleStatusTone {
  if (!value) return "neutral";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "neutral";
  const due = new Date(`${day}T00:00:00Z`);
  const checked = new Date(checkedAt);
  if (
    Number.isNaN(due.getTime()) ||
    Number.isNaN(checked.getTime()) ||
    due.toISOString().slice(0, 10) !== day
  )
    return "neutral";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(checked);
  const days = (due.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days < 0 ? "error" : days <= 30 ? "warning" : "success";
}

export function getPositionVariant(
  status: string | null | undefined,
  due: string | null | undefined,
  checkedAt: string,
): VehicleStatusTone {
  const tone = getStatusVariant(status);
  if (tone !== "success") return tone;
  const dateTone = getDueDateVariant(due, checkedAt);
  return dateTone === "neutral" ? tone : dateTone;
}
