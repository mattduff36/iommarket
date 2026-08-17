const FORBIDDEN_CLIENT_KEYS = [
  "nativeAmount",
  "nativeCurrency",
  "rate",
  "fxRate",
  "fx",
  "markup",
  "uplift",
  "policyFactor",
  "billedCost",
  "effectiveCost",
  "raw",
  "tags",
  "checksum",
  "token",
  "email",
] as const;

export const COST_FORBIDDEN_CLIENT_KEYS = FORBIDDEN_CLIENT_KEYS;

export function assertNoSensitiveCostFields(
  value: unknown,
  path = "payload",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoSensitiveCostFields(item, `${path}[${index}]`);
    });
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_CLIENT_KEYS.includes(key as (typeof FORBIDDEN_CLIENT_KEYS)[number])) {
      throw new Error(`Sensitive cost field leaked at ${path}.${key}`);
    }
    assertNoSensitiveCostFields(nested, `${path}.${key}`);
  }
}

export function hasSensitiveCostField(value: unknown): boolean {
  try {
    assertNoSensitiveCostFields(value);
    return false;
  } catch {
    return true;
  }
}

export function allowlistedFocusTags(
  tags: Record<string, unknown> | null | undefined,
): Record<string, string> {
  if (!tags) return {};
  const allowed = [
    "ProjectId",
    "projectId",
    "ProjectName",
    "projectName",
    "ResourceId",
    "resourceId",
    "StoreId",
    "storeId",
    "integrationResourceId",
  ];
  const result: Record<string, string> = {};
  for (const key of allowed) {
    const value = tags[key];
    if (typeof value === "string" && value.trim()) {
      result[key] = value.trim();
    }
  }
  return result;
}
