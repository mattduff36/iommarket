import { z } from "zod";
import {
  formatRegistrationForApi,
  isSupportedVehicleRegistration,
} from "@/lib/utils/registration";

export const vehicleCheckSchema = z.object({
  registration: z
    .string()
    .trim()
    .min(2, "Enter a registration number")
    .max(16, "Registration number is too long")
    .transform((value) => formatRegistrationForApi(value))
    .refine(
      (value) => isSupportedVehicleRegistration(value),
      "Enter a valid UK or Isle of Man registration"
    ),
});

export type VehicleCheckInput = z.infer<typeof vehicleCheckSchema>;
