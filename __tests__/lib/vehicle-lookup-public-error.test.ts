import { describe, expect, it } from "vitest";
import { VehicleLookupError } from "@/lib/services/vehicle-check-error";
import { vehicleLookupPublicError } from "@/lib/services/vehicle-lookup-public-error";
import { publicAuthErrorMessage } from "@/lib/forms/action-error";
import { publicPasswordPolicyMessage } from "@/lib/forms/password-policy-message";

describe("safe provider boundary reasons", () => {
  it("uses the known code even when provider text contains a secret", () => {
    expect(vehicleLookupPublicError(new VehicleLookupError("token=secret", { code: "LOOKUP_TIMEOUT", status: 504 }))).toEqual({
      message: "The vehicle lookup timed out. Try again shortly or enter the details manually.", status: 504,
    });
    expect(vehicleLookupPublicError(new Error("https://provider.example/secret")).message).not.toContain("secret");
  });
  it("does not trust arbitrary text merely because it says try again or check", () => {
    expect(publicAuthErrorMessage("Check token=secret and try again", "Safe fallback.")).toBe("Safe fallback.");
    expect(publicPasswordPolicyMessage("Password should contain at least one character of each: token=secret.")).toBeNull();
  });
});
