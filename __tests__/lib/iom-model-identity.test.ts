import { describe, expect, it } from "vitest";
import { resolveIomModelIdentity, separateModelVariant } from "@/lib/services/iom-model-identity";

const iom = { make: "VOLVO", model: "V50", modelVariant: "R-DESIGN EDIT D2", previousUkRegistration: "GF61FWX", dateOfFirstRegistration: "1 October 2011", engineSizeCc: 1560, fuelType: "DIESEL" };
const uk = { registrationNumber: "GF61 FWX", make: "Volvo", model: "V50", yearOfManufacture: 2011, engineSizeCc: 1560, fuelType: "Diesel" };
const mot = { registrationNumber: "GF61FWX", make: "VOLVO", model: "V50", firstUsedDate: "2011-10-01", fuelType: "DIESEL" };

describe("IOM model and trim identity", () => {
  it("uses the explicitly linked UK base model and keeps IOM trim separate", () => {
    expect(resolveIomModelIdentity(iom, uk, mot)).toEqual({ model: "V50", variant: "R-DESIGN EDIT D2", source: "previous-uk", warning: null });
  });
  it("works with MOT model when DVLA has no model", () => {
    expect(resolveIomModelIdentity(iom, { ...uk, model: null }, mot).model).toBe("V50");
  });
  it("does not use UK records without an explicit previous registration", () => {
    expect(resolveIomModelIdentity({ ...iom, previousUkRegistration: null }, uk, mot).source).toBe("iom");
  });
  it("retains the actual IOM model when the linked provider is unavailable", () => {
    expect(resolveIomModelIdentity(iom, null, null)).toMatchObject({ model: "V50", variant: "R-DESIGN EDIT D2", source: "iom" });
  });
  it.each([
    { make: "FORD" },
    { registrationNumber: "OTHER1" },
    { yearOfManufacture: 2020 },
    { engineSizeCc: 2400 },
    { fuelType: "PETROL" },
    { model: "C30" },
  ])("does not silently accept conflicting linked data: %j", (change) => {
    expect(resolveIomModelIdentity(iom, { ...uk, ...change }, mot)).toMatchObject({ source: "iom", model: "V50", warning: expect.stringContaining("Confirm the model manually") });
  });
  it("does not override a conflicting explicit IOM base model", () => {
    expect(resolveIomModelIdentity({ ...iom, model: "C30" }, uk, mot)).toMatchObject({ model: "C30", source: "iom", warning: expect.any(String) });
  });
  it("does not turn a trim-only source into a model", () => {
    expect(resolveIomModelIdentity({ ...iom, model: iom.modelVariant, previousUkRegistration: null }, null, null)).toMatchObject({ model: null, variant: "R-DESIGN EDIT D2", source: "unresolved" });
  });
  it("keeps compatible MOT data usable when DVLA lacks a make", () => {
    expect(resolveIomModelIdentity(iom, { ...uk, make: null, model: null }, mot).source).toBe("previous-uk");
  });
  it("removes a repeated model prefix or duplicate variant", () => {
    expect(separateModelVariant("V50", " V50 R-DESIGN EDIT D2 ")).toBe("R-DESIGN EDIT D2");
    expect(separateModelVariant("V50", "v50")).toBeNull();
    expect(separateModelVariant("V5", "V50 DESIGN")).toBe("V50 DESIGN");
  });
});
