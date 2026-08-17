export const VEHICLE_CHECK_ACK_STORAGE_KEY =
  "itrader-vehicle-check-terms-acknowledgement";

export interface VehicleCheckAcknowledgement {
  version: string;
  acknowledgedAt: string;
}

export function parseVehicleCheckAcknowledgement(
  raw: string | null | undefined,
): VehicleCheckAcknowledgement | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<VehicleCheckAcknowledgement>;
    if (
      typeof parsed.version !== "string" ||
      !parsed.version ||
      typeof parsed.acknowledgedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.acknowledgedAt))
    ) {
      return null;
    }
    return {
      version: parsed.version,
      acknowledgedAt: parsed.acknowledgedAt,
    };
  } catch {
    return null;
  }
}

export function hasCurrentVehicleCheckAcknowledgement(
  state: VehicleCheckAcknowledgement | null,
  policyVersion: string,
) {
  return state?.version === policyVersion;
}

export function buildVehicleCheckAcknowledgement(
  policyVersion: string,
  acknowledgedAt = new Date().toISOString(),
): VehicleCheckAcknowledgement {
  return { version: policyVersion, acknowledgedAt };
}

export function serializeVehicleCheckAcknowledgement(
  state: VehicleCheckAcknowledgement,
) {
  return JSON.stringify(state);
}
