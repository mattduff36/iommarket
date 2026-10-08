import { isVehicleLookupError } from "./vehicle-check-error";

/** Map stable provider codes, never provider exception text. */
export function vehicleLookupPublicError(error: unknown): { message: string; status: number } {
  const code = isVehicleLookupError(error) ? error.code : "unknown";
  if (code === "INVALID_REGISTRATION") return { message: "Enter a valid UK or Isle of Man registration", status: 400 };
  if (code === "VEHICLE_NOT_FOUND") return { message: "Vehicle not found for that registration. Check the number plate or enter the details manually.", status: 404 };
  if (code === "LOOKUP_TIMEOUT") return { message: "The vehicle lookup timed out. Try again shortly or enter the details manually.", status: 504 };
  if (code === "MOT_RATE_LIMITED") return { message: "The vehicle history service is busy. Try again later or enter the details manually.", status: 503 };
  return { message: "Vehicle lookup is temporarily unavailable. Try again shortly or enter the details manually.", status: 503 };
}
