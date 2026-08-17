import { describe, expect, it } from "vitest";
import {
  buildVehicleCheckAcknowledgement,
  hasCurrentVehicleCheckAcknowledgement,
  parseVehicleCheckAcknowledgement,
  serializeVehicleCheckAcknowledgement,
} from "@/lib/consent/vehicle-check-acknowledgement";

describe("Vehicle Check acknowledgement MD-VEH-001", () => {
  it("accepts only the current policy version", () => {
    const acknowledgement = buildVehicleCheckAcknowledgement(
      "2026-08-17.1",
      "2026-08-17T10:00:00.000Z",
    );

    expect(
      hasCurrentVehicleCheckAcknowledgement(
        parseVehicleCheckAcknowledgement(
          serializeVehicleCheckAcknowledgement(acknowledgement),
        ),
        "2026-08-17.1",
      ),
    ).toBe(true);
    expect(
      hasCurrentVehicleCheckAcknowledgement(
        acknowledgement,
        "2026-08-18.1",
      ),
    ).toBe(false);
  });

  it("stores no registration or result data", () => {
    const serialized = serializeVehicleCheckAcknowledgement(
      buildVehicleCheckAcknowledgement("2026-08-17.1"),
    );
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      "version",
      "acknowledgedAt",
    ]);
    expect(serialized).not.toMatch(/registration|result/i);
  });
});
