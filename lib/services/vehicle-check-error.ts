export class VehicleLookupError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "VehicleLookupError";
    this.code = options?.code ?? "VEHICLE_LOOKUP_ERROR";
    this.status = options?.status ?? 500;
  }
}

export function isVehicleLookupError(error: unknown): error is VehicleLookupError {
  return error instanceof VehicleLookupError;
}
