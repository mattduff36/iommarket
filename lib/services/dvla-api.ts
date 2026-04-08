import { fetchWithTimeout } from "@/lib/services/http";
import { VehicleLookupError } from "@/lib/services/vehicle-check-error";
import { normalizeRegistration } from "@/lib/utils/registration";

interface DVLAVehicleApiResponse {
  registrationNumber?: string;
  taxStatus?: string;
  taxDueDate?: string;
  motStatus?: string;
  motExpiryDate?: string;
  make?: string;
  model?: string;
  colour?: string;
  yearOfManufacture?: number;
  engineCapacity?: number;
  fuelType?: string;
  co2Emissions?: number;
  monthOfFirstRegistration?: string;
  monthOfFirstDvlaRegistration?: string;
  wheelplan?: string;
  euroStatus?: string;
  revenueWeight?: number;
}

export interface DVLAVehicleData {
  registrationNumber: string;
  taxStatus: string | null;
  taxDueDate: string | null;
  motStatus: string | null;
  motExpiryDate: string | null;
  make: string | null;
  model: string | null;
  colour: string | null;
  yearOfManufacture: number | null;
  engineSizeCc: number | null;
  fuelType: string | null;
  co2Emissions: number | null;
  monthOfFirstRegistration: string | null;
  wheelPlan: string | null;
  euroStatus: string | null;
  revenueWeight: number | null;
  rawData: unknown;
}

export interface DVLAApiService {
  getVehicleData(registrationNumber: string): Promise<DVLAVehicleData>;
}

export function createDVLAApiService(): DVLAApiService | null {
  const provider = process.env.DVLA_API_PROVIDER;
  const apiKey = process.env.DVLA_API_KEY;
  const baseUrl = process.env.DVLA_API_BASE_URL;

  if (!provider || !apiKey || !baseUrl) {
    return null;
  }

  return {
    async getVehicleData(registrationNumber: string) {
      const normalizedRegistration = normalizeRegistration(registrationNumber);
      const response = await fetchWithTimeout(
        `${baseUrl.replace(/\/$/, "")}/vehicles`,
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            registrationNumber: normalizedRegistration,
          }),
          cache: "no-store",
        }
      );

      if (response.status === 404) {
        throw new VehicleLookupError(
          "Vehicle not found for that registration",
          { code: "VEHICLE_NOT_FOUND", status: 404 }
        );
      }

      if (response.status === 400) {
        throw new VehicleLookupError(
          "Invalid vehicle registration",
          { code: "INVALID_REGISTRATION", status: 400 }
        );
      }

      if (!response.ok) {
        throw new VehicleLookupError(
          "DVLA lookup failed",
          { code: "DVLA_LOOKUP_FAILED", status: 502 }
        );
      }

      const payload = (await response.json()) as DVLAVehicleApiResponse;

      return {
        registrationNumber:
          payload.registrationNumber ?? normalizedRegistration,
        taxStatus: payload.taxStatus ?? null,
        taxDueDate: payload.taxDueDate ?? null,
        motStatus: payload.motStatus ?? null,
        motExpiryDate: payload.motExpiryDate ?? null,
        make: payload.make ?? null,
        model: payload.model ?? null,
        colour: payload.colour ?? null,
        yearOfManufacture: payload.yearOfManufacture ?? null,
        engineSizeCc: payload.engineCapacity ?? null,
        fuelType: payload.fuelType ?? null,
        co2Emissions: payload.co2Emissions ?? null,
        monthOfFirstRegistration:
          payload.monthOfFirstRegistration ??
          payload.monthOfFirstDvlaRegistration ??
          null,
        wheelPlan: payload.wheelplan ?? null,
        euroStatus: payload.euroStatus ?? null,
        revenueWeight: payload.revenueWeight ?? null,
        rawData: payload,
      };
    },
  };
}
