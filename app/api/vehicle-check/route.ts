import { NextRequest, NextResponse } from "next/server";
import { getVehicleCheckResult } from "@/lib/services/vehicle-check-aggregator";
import {
  isVehicleLookupError,
  VehicleLookupError,
} from "@/lib/services/vehicle-check-error";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { vehicleCheckSchema } from "@/lib/validations/vehicle-check";

const MAX_BODY_BYTES = 8_000;

function getRequesterKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return `${ip ?? "unknown"}:${userAgent}`;
}

function toJsonError(error: unknown): { message: string; status: number } {
  if (isVehicleLookupError(error)) {
    return {
      message: error.message,
      status: error.status,
    };
  }

  if (error instanceof VehicleLookupError) {
    return { message: error.message, status: error.status };
  }

  return {
    message: error instanceof Error ? error.message : "Vehicle lookup failed",
    status: 500,
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const rate = checkRateLimit(
    makeRateLimitKey("vehicle-check", getRequesterKey(request)),
    { windowMs: 60_000, maxRequests: 10 }
  );

  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = vehicleCheckSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await getVehicleCheckResult(parsed.data.registration);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const jsonError = toJsonError(error);
    return NextResponse.json(
      { error: jsonError.message },
      { status: jsonError.status }
    );
  }
}
