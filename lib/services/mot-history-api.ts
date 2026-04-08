import { fetchWithTimeout } from "@/lib/services/http";
import { VehicleLookupError } from "@/lib/services/vehicle-check-error";
import { normalizeRegistration } from "@/lib/utils/registration";

const PASS_RESULTS = new Set(["PASSED", "PASS", "PRS"]);

interface MotTokenResponse {
  access_token: string;
  expires_in: number;
}

interface MotApiDefect {
  text?: string;
  type?: string;
  dangerous?: boolean;
}

interface MotApiTest {
  completedDate?: string;
  testResult?: string;
  expiryDate?: string;
  odometerValue?: string;
  odometerUnit?: "MI" | "KM" | null;
  motTestNumber?: string;
  defects?: MotApiDefect[];
}

interface MotApiVehicleResponse {
  registration?: string;
  make?: string;
  model?: string;
  firstUsedDate?: string;
  fuelType?: string;
  primaryColour?: string;
  motTests?: MotApiTest[];
  motTestDueDate?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export interface MotHistoryDefect {
  text: string;
  type: string;
  dangerous: boolean;
}

export interface MotHistoryTest {
  completedDate: string;
  testResult: string;
  expiryDate: string | null;
  odometerValue: number | null;
  odometerUnit: "mi" | "km" | null;
  motTestNumber: string | null;
  defects: MotHistoryDefect[];
}

export interface MotHistoryData {
  registration: string;
  make: string | null;
  model: string | null;
  firstUsedDate: string | null;
  fuelType: string | null;
  primaryColour: string | null;
  motTests: MotHistoryTest[];
  motTestDueDate: string | null;
  rawData: unknown;
}

export interface MotExpiryData {
  registration: string;
  motExpiryDate: string | null;
  motStatus: string | null;
  lastTestDate: string | null;
  lastTestResult: string | null;
  rawData: unknown;
}

export interface MotHistoryService {
  getMotHistory(registration: string): Promise<MotHistoryData | null>;
  getMotExpiryData(registration: string): Promise<MotExpiryData | null>;
}

export function createMotHistoryService(): MotHistoryService | null {
  const envClientId = process.env.MOT_API_CLIENT_ID;
  const envClientSecret = process.env.MOT_API_CLIENT_SECRET;
  const envScope = process.env.MOT_API_SCOPE;
  const envAccessTokenUrl = process.env.MOT_API_ACCESS_TOKEN_URL;
  const envApiKey = process.env.MOT_API_KEY;
  const baseUrl =
    process.env.MOT_API_BASE_URL ?? "https://history.mot.api.gov.uk";

  if (!envClientId || !envClientSecret || !envScope || !envAccessTokenUrl || !envApiKey) {
    return null;
  }

  const clientId = envClientId;
  const clientSecret = envClientSecret;
  const scope = envScope;
  const accessTokenUrl = envAccessTokenUrl;
  const apiKey = envApiKey;

  async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
      return cachedToken.accessToken;
    }

    const tokenResponse = await fetchWithTimeout(
      accessTokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope,
        }).toString(),
        cache: "no-store",
      }
    );

    if (!tokenResponse.ok) {
      throw new VehicleLookupError("MOT token request failed", {
        code: "MOT_TOKEN_REQUEST_FAILED",
        status: 502,
      });
    }

    const tokenPayload = (await tokenResponse.json()) as MotTokenResponse;
    cachedToken = {
      accessToken: tokenPayload.access_token,
      expiresAt: Date.now() + tokenPayload.expires_in * 1_000,
    };

    return tokenPayload.access_token;
  }

  async function getMotHistory(
    registration: string
  ): Promise<MotHistoryData | null> {
    const normalizedRegistration = normalizeRegistration(registration);
    const token = await getAccessToken();
    const response = await fetchWithTimeout(
      `${baseUrl.replace(/\/$/, "")}/v1/trade/vehicles/registration/${normalizedRegistration}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      throw new VehicleLookupError("MOT rate limit exceeded", {
        code: "MOT_RATE_LIMITED",
        status: 429,
      });
    }

    if (response.status === 400) {
      throw new VehicleLookupError("Invalid vehicle registration", {
        code: "INVALID_REGISTRATION",
        status: 400,
      });
    }

    if (!response.ok) {
      throw new VehicleLookupError("MOT lookup failed", {
        code: "MOT_LOOKUP_FAILED",
        status: 502,
      });
    }

    const payload = (await response.json()) as
      | MotApiVehicleResponse
      | MotApiVehicleResponse[];
    const vehiclePayload = Array.isArray(payload) ? payload[0] : payload;

    const motTests = [...(vehiclePayload?.motTests ?? [])]
      .map<MotHistoryTest>((test) => ({
        completedDate: test.completedDate ?? "",
        testResult: test.testResult ?? "UNKNOWN",
        expiryDate: test.expiryDate ?? null,
        odometerValue: test.odometerValue
          ? Number.parseInt(test.odometerValue.replace(/,/g, ""), 10)
          : null,
        odometerUnit:
          test.odometerUnit === "KM"
            ? "km"
            : test.odometerUnit === "MI"
              ? "mi"
              : null,
        motTestNumber: test.motTestNumber ?? null,
        defects: (test.defects ?? []).map((defect) => ({
          text: defect.text ?? "",
          type: (defect.type ?? "ADVISORY").toUpperCase(),
          dangerous: Boolean(defect.dangerous),
        })),
      }))
      .sort(
        (left, right) =>
          new Date(right.completedDate).getTime() -
          new Date(left.completedDate).getTime()
      );

    return {
      registration: vehiclePayload?.registration ?? normalizedRegistration,
      make: vehiclePayload?.make ?? null,
      model: vehiclePayload?.model ?? null,
      firstUsedDate: vehiclePayload?.firstUsedDate ?? null,
      fuelType: vehiclePayload?.fuelType ?? null,
      primaryColour: vehiclePayload?.primaryColour ?? null,
      motTests,
      motTestDueDate: vehiclePayload?.motTestDueDate ?? null,
      rawData: vehiclePayload ?? payload,
    };
  }

  async function getMotExpiryData(
    registration: string
  ): Promise<MotExpiryData | null> {
    const history = await getMotHistory(registration);
    if (!history) {
      return null;
    }

    const latestTest = history.motTests[0] ?? null;
    const latestPassedTest =
      history.motTests.find((test) => PASS_RESULTS.has(test.testResult)) ?? null;

    return {
      registration: history.registration,
      motExpiryDate:
        latestPassedTest?.expiryDate ?? history.motTestDueDate ?? null,
      motStatus:
        latestPassedTest?.expiryDate ??
        history.motTestDueDate
          ? "Valid"
          : latestTest?.testResult === "FAILED"
            ? "Not valid"
            : null,
      lastTestDate: latestTest?.completedDate ?? null,
      lastTestResult: latestTest?.testResult ?? null,
      rawData: history.rawData,
    };
  }

  return {
    getMotHistory,
    getMotExpiryData,
  };
}
