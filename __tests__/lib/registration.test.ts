import { describe, expect, it } from "vitest";
import {
  formatIomRegistrationForApi,
  formatRegistrationForDisplay,
  formatRegistrationForApi,
  getRegistrationRegion,
  isManxRegistration,
  isSupportedVehicleRegistration,
  isUkRegistration,
} from "@/lib/utils/registration";

describe("registration utilities", () => {
  it("normalizes registrations for API lookups", () => {
    expect(formatRegistrationForApi(" ab12 cde ")).toBe("AB12CDE");
    expect(formatRegistrationForApi("man 123")).toBe("MAN123");
  });

  it("detects UK registrations", () => {
    expect(isUkRegistration("AB12 CDE")).toBe(true);
    expect(isUkRegistration("A123 BCD")).toBe(true);
    expect(isUkRegistration("INVALID")).toBe(false);
  });

  it("detects Isle of Man registrations", () => {
    expect(isManxRegistration("MAN 123")).toBe(true);
    expect(isManxRegistration("PMN 147 E")).toBe(true);
    expect(isManxRegistration("79NMN")).toBe(true);
    expect(isManxRegistration("AB12 CDE")).toBe(false);
  });

  it("accepts supported vehicle registrations", () => {
    expect(isSupportedVehicleRegistration("AB12 CDE")).toBe(true);
    expect(isSupportedVehicleRegistration("MAN 123")).toBe(true);
    expect(isSupportedVehicleRegistration("???")).toBe(false);
  });

  it("classifies registrations for badge display", () => {
    expect(getRegistrationRegion("AB12 CDE")).toBe("uk");
    expect(getRegistrationRegion("MAN 123")).toBe("iom");
    expect(getRegistrationRegion("")).toBe("unrecognized");
    expect(getRegistrationRegion("HELLO")).toBe("unrecognized");
  });

  it("formats display registrations with UK and IoM spacing", () => {
    expect(formatRegistrationForDisplay("AB12CDE")).toBe("AB12 CDE");
    expect(formatRegistrationForDisplay("K6SPD")).toBe("K6 SPD");
    expect(formatRegistrationForDisplay("MAN123")).toBe("MAN 123");
    expect(formatRegistrationForDisplay("PMN147E")).toBe("PMN 147 E");
  });

  it("formats Isle of Man registrations for the gov.im lookup", () => {
    expect(formatIomRegistrationForApi("MAN123")).toBe("MAN-123");
    expect(formatIomRegistrationForApi("PMN 147 E")).toBe("PMN-147-E");
    expect(formatIomRegistrationForApi("1MN00")).toBe("1-MN-00");
  });
});
