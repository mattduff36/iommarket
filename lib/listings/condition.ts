export type VehicleCondition = "NEW" | "USED";

/** Only explicit condition metadata qualifies: mileage, age and sales copy are not evidence. */
export function explicitVehicleCondition(value: unknown): VehicleCondition | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
  if (["new", "newcondition", "brand new"].includes(normalized)) return "NEW";
  if (["used", "usedcondition", "pre-owned", "pre owned"].includes(normalized)) return "USED";
  return null;
}

export function resolveConditionEvidence(values: unknown[]) {
  const evidence = new Set(values.map(explicitVehicleCondition).filter(Boolean));
  if (evidence.size !== 1) return { condition: "USED" as const, reviewRequired: true };
  return { condition: [...evidence][0]!, reviewRequired: false };
}

/** Explicit stock route metadata, never arbitrary title/slug substrings such as cars_new.html. */
export function stockRouteCondition(value: unknown): VehicleCondition | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
    if (segments.some((part) => /^(used-(?:cars|vans|vehicles|motorcycles|bikes)|pre-owned)$/.test(part))) return "USED";
    if (segments.some((part) => /^new-(?:cars|vans|vehicles|motorcycles|bikes)$/.test(part))) return "NEW";
    if (segments.includes("used") && segments.some((part) => ["cars", "vans", "bikes"].includes(part))) return "USED";
    if (url.hostname.replace(/^www\./, "") === "mikesmotors.im" && /^\/used-[a-z0-9-]+-\d+\/?$/.test(url.pathname)) return "USED";
    if (url.hostname.replace(/^www\./, "") === "manxcarwarehouse.im" && url.pathname.startsWith("/stock/used-cars-in-")) return "USED";
  } catch { /* Invalid source metadata remains uncertain. */ }
  return null;
}
