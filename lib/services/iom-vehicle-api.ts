import { calculateIomVehicleDuty } from "@/lib/services/iom-vehicle-duty";
import { fetchWithTimeout } from "@/lib/services/http";
import { VehicleLookupError } from "@/lib/services/vehicle-check-error";
import {
  formatIomRegistrationForApi,
  formatRegistrationForApi,
} from "@/lib/utils/registration";

const GOV_IM_URL = "https://services.gov.im/service/VehicleSearch";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface IomVehicleData {
  registrationNumber: string;
  make: string | null;
  model: string | null;
  modelVariant: string | null;
  category: string | null;
  colour: string | null;
  engineSizeCc: number | null;
  fuelType: string | null;
  co2Emissions: number | null;
  dateOfFirstRegistration: string | null;
  previousUkRegistration: string | null;
  dateOfFirstRegistrationIom: string | null;
  wheelPlan: string | null;
  taxStatus: string | null;
  taxDueDate: string | null;
  roadTax12Month: string | null;
  roadTax6Month: string | null;
  rawData: unknown;
}

export interface IomVehicleApiService {
  getVehicleData(registrationNumber: string): Promise<IomVehicleData>;
}

function getCookieValues(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headers.getSetCookie === "function") {
    return headers
      .getSetCookie()
      .map((value) => value.split(";")[0]?.trim())
      .filter(Boolean) as string[];
  }

  const rawCookie = response.headers.get("set-cookie");
  if (!rawCookie) return [];

  return rawCookie
    .split(/,\s*(?=[A-Za-z0-9_-]+=)/)
    .map((value) => value.split(";")[0]?.trim())
    .filter(Boolean) as string[];
}

function parseValue(html: string, label: string): string | null {
  const patterns = [
    new RegExp(
      `<[^>]*>\\s*${label}\\s*<[^>]*>[\\s\\S]*?<[^>]*>\\s*([^<]+?)\\s*</`,
      "i"
    ),
    new RegExp(
      `<[^>]*>[^<]*${label}[^<]*</[^>]*>\\s*<[^>]*>\\s*([^<]+?)\\s*</`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = match[1].replace(/&nbsp;/g, " ").trim();
      return value || null;
    }
  }

  return null;
}

function mapTaxStatus(status: string | null): string | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized.includes("active") || normalized.includes("valid")) {
    return "Taxed";
  }
  if (normalized.includes("sorn")) {
    return "SORN";
  }
  return "Untaxed";
}

export function createIomVehicleApiService(): IomVehicleApiService {
  return {
    async getVehicleData(registrationNumber: string) {
      const normalizedRegistration = formatRegistrationForApi(registrationNumber);
      const lookupRegistration = formatIomRegistrationForApi(registrationNumber);
      const cookieJar = new Map<string, string>();

      const requestHeaders = () => ({
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        Cookie: [...cookieJar.values()].join("; "),
      });

      let currentUrl = GOV_IM_URL;
      let searchPageHtml = "";

      for (let index = 0; index < 4; index += 1) {
        const response = await fetchWithTimeout(
          currentUrl,
          {
            headers: requestHeaders(),
            redirect: "manual",
            cache: "no-store",
          },
          5_000
        );

        for (const cookie of getCookieValues(response)) {
          const cookieName = cookie.split("=")[0];
          if (cookieName) {
            cookieJar.set(cookieName, cookie);
          }
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) break;
          currentUrl = location.startsWith("http")
            ? location
            : `https://services.gov.im${location}`;
          continue;
        }

        searchPageHtml = await response.text();
        break;
      }

      if (!searchPageHtml) {
        throw new VehicleLookupError("Isle of Man lookup is unavailable", {
          code: "IOM_LOOKUP_UNAVAILABLE",
          status: 502,
        });
      }

      const csrfTokenMatch = searchPageHtml.match(
        /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i
      );
      if (!csrfTokenMatch?.[1]) {
        throw new VehicleLookupError("Isle of Man lookup token was not found", {
          code: "IOM_LOOKUP_TOKEN_MISSING",
          status: 502,
        });
      }

      const lookupResponse = await fetchWithTimeout(
        GOV_IM_URL,
        {
          method: "POST",
          headers: {
            ...requestHeaders(),
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: GOV_IM_URL,
          },
          body: new URLSearchParams({
            RegMarkNo: lookupRegistration,
            __RequestVerificationToken: csrfTokenMatch[1],
          }).toString(),
          redirect: "follow",
          cache: "no-store",
        },
        5_000
      );

      if (!lookupResponse.ok) {
        throw new VehicleLookupError("Isle of Man lookup failed", {
          code: "IOM_LOOKUP_FAILED",
          status: 502,
        });
      }

      const html = await lookupResponse.text();
      if (
        html.includes("No vehicle found") ||
        html.includes("Vehicle not found") ||
        html.includes("requested URL was rejected")
      ) {
        throw new VehicleLookupError(
          "Vehicle not found on the Isle of Man registry",
          {
            code: "VEHICLE_NOT_FOUND",
            status: 404,
          }
        );
      }

      const make = parseValue(html, "Make");
      if (!make) {
        throw new VehicleLookupError(
          "Vehicle not found on the Isle of Man registry",
          {
            code: "VEHICLE_NOT_FOUND",
            status: 404,
          }
        );
      }

      const dateOfFirstRegistration = parseValue(
        html,
        "Date of First Registration"
      );
      const taxStatus = parseValue(html, "Status of Vehicle Licence");
      const engineSizeRaw = parseValue(html, "Cubic Capacity");
      const co2Raw = parseValue(html, "CO2 Emission");
      const yearOfManufactureMatch = dateOfFirstRegistration?.match(/(\d{4})/);
      const yearOfManufacture = yearOfManufactureMatch
        ? Number.parseInt(yearOfManufactureMatch[1], 10)
        : null;

      const engineSizeCc = engineSizeRaw
        ? Number.parseInt(engineSizeRaw.replace(/[^\d]/g, ""), 10)
        : null;
      const co2Emissions = co2Raw
        ? Number.parseFloat(co2Raw.replace(/[^\d.]/g, ""))
        : null;

      const duty = calculateIomVehicleDuty({
        co2Emissions,
        engineSizeCc,
        yearOfManufacture,
        firstRegistrationDate: dateOfFirstRegistration,
      });

      return {
        registrationNumber: normalizedRegistration,
        make,
        model: parseValue(html, "Model"),
        modelVariant: parseValue(html, "Model Variant"),
        category: parseValue(html, "Category"),
        colour: parseValue(html, "Colour"),
        engineSizeCc: Number.isNaN(engineSizeCc ?? NaN) ? null : engineSizeCc,
        fuelType: parseValue(html, "Fuel"),
        co2Emissions: Number.isNaN(co2Emissions ?? NaN) ? null : co2Emissions,
        dateOfFirstRegistration,
        previousUkRegistration: parseValue(html, "Previous Registration Number"),
        dateOfFirstRegistrationIom: parseValue(
          html,
          "Date of First Registration on IOM"
        ),
        wheelPlan: parseValue(html, "Wheel Plan"),
        taxStatus: mapTaxStatus(taxStatus),
        taxDueDate: parseValue(html, "Expiry Date of Vehicle Licence"),
        roadTax12Month: duty?.duty12Month ?? null,
        roadTax6Month: duty?.duty6Month ?? null,
        rawData: html,
      };
    },
  };
}
