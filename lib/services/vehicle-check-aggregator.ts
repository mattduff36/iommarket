import {
  createAuctionHistoryApiService,
  type AuctionHistoryEntry,
} from "@/lib/services/auction-history-api";
import {
  createDVLAApiService,
  type DVLAVehicleData,
} from "@/lib/services/dvla-api";
import {
  createIomVehicleApiService,
  type IomVehicleData,
} from "@/lib/services/iom-vehicle-api";
import {
  createMotHistoryService,
  type MotHistoryData,
  type MotHistoryTest,
} from "@/lib/services/mot-history-api";
import {
  VehicleLookupError,
  isVehicleLookupError,
} from "@/lib/services/vehicle-check-error";
import type {
  VehicleAuctionHistory,
  VehicleCheckResult,
  VehicleMileageSummary,
  VehicleMotHistory,
  VehicleRecord,
  VehicleLookupSourceNote,
} from "@/lib/services/vehicle-check-types";
import {
  formatRegistrationForDisplay,
  isManxRegistration,
  isSupportedVehicleRegistration,
  normalizeRegistration,
} from "@/lib/utils/registration";

const PASS_RESULTS = new Set(["PASSED", "PASS", "PRS"]);

function calculateFallbackMotDueDate(dvlaVehicle: DVLAVehicleData): string | null {
  if (!dvlaVehicle.monthOfFirstRegistration) return null;

  const firstRegistrationDate = new Date(`${dvlaVehicle.monthOfFirstRegistration}-01`);
  if (Number.isNaN(firstRegistrationDate.getTime())) {
    return null;
  }

  const isHeavyVehicle =
    (dvlaVehicle.revenueWeight ?? 0) > 3_500 ||
    (dvlaVehicle.wheelPlan ?? "").toLowerCase().includes("articulated") ||
    (dvlaVehicle.wheelPlan ?? "").toLowerCase().includes("rigid");

  const nextDate = new Date(firstRegistrationDate);
  nextDate.setFullYear(nextDate.getFullYear() + (isHeavyVehicle ? 1 : 3));
  return nextDate.toISOString().slice(0, 10);
}

function buildMileageSummary(history: MotHistoryData | null): VehicleMileageSummary | null {
  if (!history) return null;

  const points = history.motTests
    .filter(
      (test) =>
        PASS_RESULTS.has(test.testResult) &&
        test.odometerValue !== null &&
        Boolean(test.completedDate)
    )
    .map((test) => ({
      date: test.completedDate,
      mileage: test.odometerValue as number,
    }))
    .sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime()
    );

  if (points.length === 0) {
    return {
      latestMileage: null,
      latestMileageDate: null,
      earliestMileage: null,
      earliestMileageDate: null,
      averageAnnualMileage: null,
      points: [],
    };
  }

  const earliestPoint = points[0];
  const latestPoint = points[points.length - 1];
  const timeDiffYears =
    (new Date(latestPoint.date).getTime() -
      new Date(earliestPoint.date).getTime()) /
    (1000 * 60 * 60 * 24 * 365.25);

  return {
    latestMileage: latestPoint.mileage,
    latestMileageDate: latestPoint.date,
    earliestMileage: earliestPoint.mileage,
    earliestMileageDate: earliestPoint.date,
    averageAnnualMileage:
      timeDiffYears > 0
        ? Math.round((latestPoint.mileage - earliestPoint.mileage) / timeDiffYears)
        : null,
    points,
  };
}

function buildMotHistory(
  history: MotHistoryData | null,
  sourceRegistrationNumber: string | null
): VehicleMotHistory | null {
  if (!history) return null;

  const latestTest = history.motTests[0] ?? null;
  const latestPassedTest =
    history.motTests.find((test) => PASS_RESULTS.has(test.testResult)) ?? null;

  return {
    registrationNumber: history.registration,
    sourceRegistrationNumber,
    make: history.make,
    model: history.model,
    firstUsedDate: history.firstUsedDate,
    fuelType: history.fuelType,
    primaryColour: history.primaryColour,
    motTests: history.motTests.map((test) => ({
      completedDate: test.completedDate,
      testResult: test.testResult,
      expiryDate: test.expiryDate,
      odometerValue: test.odometerValue,
      odometerUnit: test.odometerUnit,
      motTestNumber: test.motTestNumber,
      defects: test.defects,
    })),
    motExpiryDate: latestPassedTest?.expiryDate ?? history.motTestDueDate ?? null,
    motStatus:
      latestPassedTest?.expiryDate ?? history.motTestDueDate
        ? "Valid"
        : latestTest?.testResult === "FAILED"
          ? "Not valid"
          : null,
    lastTestDate: latestTest?.completedDate ?? null,
    lastTestResult: latestTest?.testResult ?? null,
  };
}

function buildAuctionHistory(entries: AuctionHistoryEntry[]): VehicleAuctionHistory | null {
  if (entries.length === 0) return null;

  return {
    sourceLabel: "Chrystals Auctions via Easy Live Auction",
    entries: entries
      .slice()
      .sort((left, right) => {
        if (!left.saleDate) return 1;
        if (!right.saleDate) return -1;
        return new Date(right.saleDate).getTime() - new Date(left.saleDate).getTime();
      }),
  };
}

function buildUkVehicleRecord(
  registrationNumber: string,
  dvlaVehicle: DVLAVehicleData,
  motHistory: VehicleMotHistory | null
): VehicleRecord {
  const fallbackMotDueDate =
    motHistory?.motExpiryDate ??
    dvlaVehicle.motExpiryDate ??
    calculateFallbackMotDueDate(dvlaVehicle);

  return {
    registrationNumber: dvlaVehicle.registrationNumber,
    displayRegistrationNumber: formatRegistrationForDisplay(registrationNumber),
    lookupPath: "uk",
    make: dvlaVehicle.make,
    model: dvlaVehicle.model,
    colour: dvlaVehicle.colour,
    fuelType: dvlaVehicle.fuelType,
    taxStatus: dvlaVehicle.taxStatus,
    taxDueDate: dvlaVehicle.taxDueDate,
    motStatus:
      motHistory?.motStatus ??
      dvlaVehicle.motStatus ??
      (fallbackMotDueDate ? "Valid" : null),
    motExpiryDate: fallbackMotDueDate,
    yearOfManufacture: dvlaVehicle.yearOfManufacture,
    engineSizeCc: dvlaVehicle.engineSizeCc,
    co2Emissions: dvlaVehicle.co2Emissions,
    monthOfFirstRegistration: dvlaVehicle.monthOfFirstRegistration,
    wheelPlan: dvlaVehicle.wheelPlan,
    euroStatus: dvlaVehicle.euroStatus,
    category: null,
    previousUkRegistration: null,
    dateOfFirstRegistrationIom: null,
    roadTax12Month: null,
    roadTax6Month: null,
    firstUsedDate: motHistory?.firstUsedDate ?? null,
  };
}

function buildIomVehicleRecord(
  registrationNumber: string,
  iomVehicle: IomVehicleData,
  previousUkVehicle: DVLAVehicleData | null,
  motHistory: VehicleMotHistory | null
): VehicleRecord {
  return {
    registrationNumber: iomVehicle.registrationNumber,
    displayRegistrationNumber: formatRegistrationForDisplay(registrationNumber),
    lookupPath: "iom",
    make: iomVehicle.make ?? previousUkVehicle?.make ?? null,
    model:
      iomVehicle.modelVariant ??
      iomVehicle.model ??
      previousUkVehicle?.model ??
      null,
    colour: iomVehicle.colour ?? previousUkVehicle?.colour ?? null,
    fuelType: iomVehicle.fuelType ?? previousUkVehicle?.fuelType ?? null,
    taxStatus: iomVehicle.taxStatus,
    taxDueDate: iomVehicle.taxDueDate,
    motStatus:
      motHistory?.motStatus ??
      previousUkVehicle?.motStatus ??
      "No MOT history found",
    motExpiryDate:
      motHistory?.motExpiryDate ?? previousUkVehicle?.motExpiryDate ?? null,
    yearOfManufacture:
      previousUkVehicle?.yearOfManufacture ??
      (() => {
        const yearMatch = iomVehicle.dateOfFirstRegistration?.match(/(\d{4})/);
        return yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
      })(),
    engineSizeCc: iomVehicle.engineSizeCc ?? previousUkVehicle?.engineSizeCc ?? null,
    co2Emissions: iomVehicle.co2Emissions ?? previousUkVehicle?.co2Emissions ?? null,
    monthOfFirstRegistration:
      previousUkVehicle?.monthOfFirstRegistration ??
      iomVehicle.dateOfFirstRegistration ??
      null,
    wheelPlan: iomVehicle.wheelPlan ?? previousUkVehicle?.wheelPlan ?? null,
    euroStatus: previousUkVehicle?.euroStatus ?? null,
    category: iomVehicle.category,
    previousUkRegistration: iomVehicle.previousUkRegistration,
    dateOfFirstRegistrationIom: iomVehicle.dateOfFirstRegistrationIom,
    roadTax12Month: iomVehicle.roadTax12Month,
    roadTax6Month: iomVehicle.roadTax6Month,
    firstUsedDate: motHistory?.firstUsedDate ?? iomVehicle.dateOfFirstRegistration,
  };
}

function formatLookupWarning(error: unknown, fallback: string): string {
  if (isVehicleLookupError(error)) {
    return error.message;
  }

  return error instanceof Error ? error.message : fallback;
}

async function lookupUkVehicle(registrationNumber: string): Promise<VehicleCheckResult> {
  const dvlaService = createDVLAApiService();
  if (!dvlaService) {
    throw new VehicleLookupError(
      "DVLA API not configured. Please configure provider, key, and base URL.",
      {
        code: "DVLA_NOT_CONFIGURED",
        status: 503,
      }
    );
  }

  const motService = createMotHistoryService();
  const auctionService = createAuctionHistoryApiService();
  const warnings: string[] = [];

  const [dvlaVehicle, motHistoryResult, auctionResult] = await Promise.all([
    dvlaService.getVehicleData(registrationNumber),
    motService
      ?.getMotHistory(registrationNumber)
      .catch((error) => {
        warnings.push(`MOT history is unavailable right now: ${formatLookupWarning(error, "MOT lookup failed")}`);
        return null;
      }) ?? Promise.resolve(null),
    auctionService.getAuctionHistory(registrationNumber).catch((error) => {
      warnings.push(
        `Auction history is unavailable right now: ${formatLookupWarning(
          error,
          "Auction lookup failed"
        )}`
      );
      return [];
    }),
  ]);

  const motHistory = buildMotHistory(motHistoryResult, null);
  if (!motHistory && !motService) {
    warnings.push("MOT API is not configured, so MOT history could not be retrieved.");
  }

  const sourceNotes: VehicleLookupSourceNote[] = [
    { id: "dvla", label: "DVLA", detail: "Tax status and base vehicle data" },
    {
      id: "mot",
      label: "DVSA MOT",
      detail: motHistory
        ? "MOT history and expiry data pulled from the MOT API"
        : "No MOT history available for this registration",
    },
    {
      id: "auction",
      label: "Auction history",
      detail:
        auctionResult.length > 0
          ? "Live external auction matches found"
          : "No live auction matches found",
    },
  ];

  return {
    normalizedRegistration: normalizeRegistration(registrationNumber),
    displayRegistration: formatRegistrationForDisplay(registrationNumber),
    isManx: false,
    lookupTargetRegistration: normalizeRegistration(registrationNumber),
    vehicle: buildUkVehicleRecord(registrationNumber, dvlaVehicle, motHistory),
    motHistory,
    mileage: buildMileageSummary(motHistoryResult),
    auctionHistory: buildAuctionHistory(auctionResult),
    warnings,
    sourceNotes,
    checkedAt: new Date().toISOString(),
  };
}

async function lookupIomVehicle(registrationNumber: string): Promise<VehicleCheckResult> {
  const iomService = createIomVehicleApiService();
  const motService = createMotHistoryService();
  const dvlaService = createDVLAApiService();
  const auctionService = createAuctionHistoryApiService();
  const warnings: string[] = [];

  const [iomVehicle, auctionResult] = await Promise.all([
    iomService.getVehicleData(registrationNumber),
    auctionService.getAuctionHistory(registrationNumber).catch((error) => {
      warnings.push(
        `Auction history is unavailable right now: ${formatLookupWarning(
          error,
          "Auction lookup failed"
        )}`
      );
      return [];
    }),
  ]);

  const previousUkRegistration = iomVehicle.previousUkRegistration;
  const normalizedPreviousUkRegistration = previousUkRegistration
    ? normalizeRegistration(previousUkRegistration)
    : null;

  const [motHistoryResult, previousUkVehicle] = await Promise.all([
    normalizedPreviousUkRegistration && motService
      ? motService.getMotHistory(normalizedPreviousUkRegistration).catch((error) => {
          warnings.push(
            `MOT history for previous UK registration could not be retrieved: ${formatLookupWarning(
              error,
              "MOT lookup failed"
            )}`
          );
          return null;
        })
      : Promise.resolve(null),
    normalizedPreviousUkRegistration && dvlaService
      ? dvlaService.getVehicleData(normalizedPreviousUkRegistration).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!previousUkRegistration) {
    warnings.push(
      "No linked previous UK registration was found, so MOT data may be limited for this Manx vehicle."
    );
  } else if (!motService) {
    warnings.push(
      "MOT API is not configured, so previous UK MOT history could not be retrieved."
    );
  }

  const motHistory = buildMotHistory(
    motHistoryResult,
    previousUkRegistration ? normalizeRegistration(previousUkRegistration) : null
  );

  const sourceNotes: VehicleLookupSourceNote[] = [
    { id: "iom", label: "gov.im", detail: "Current Manx vehicle and tax data" },
    {
      id: "mot",
      label: "DVSA MOT",
      detail: previousUkRegistration
        ? `MOT history checked via previous UK registration ${formatRegistrationForDisplay(previousUkRegistration)}`
        : "No linked previous UK registration available for MOT history",
    },
    {
      id: "auction",
      label: "Auction history",
      detail:
        auctionResult.length > 0
          ? "Live external auction matches found"
          : "No live auction matches found",
    },
  ];

  return {
    normalizedRegistration: normalizeRegistration(registrationNumber),
    displayRegistration: formatRegistrationForDisplay(registrationNumber),
    isManx: true,
    lookupTargetRegistration: normalizeRegistration(registrationNumber),
    vehicle: buildIomVehicleRecord(
      registrationNumber,
      iomVehicle,
      previousUkVehicle,
      motHistory
    ),
    motHistory,
    mileage: buildMileageSummary(motHistoryResult),
    auctionHistory: buildAuctionHistory(auctionResult),
    warnings,
    sourceNotes,
    checkedAt: new Date().toISOString(),
  };
}

export async function getVehicleCheckResult(
  registrationNumber: string
): Promise<VehicleCheckResult> {
  if (!isSupportedVehicleRegistration(registrationNumber)) {
    throw new VehicleLookupError("Enter a valid UK or Isle of Man registration", {
      code: "INVALID_REGISTRATION",
      status: 400,
    });
  }

  if (isManxRegistration(registrationNumber)) {
    return lookupIomVehicle(registrationNumber);
  }

  return lookupUkVehicle(registrationNumber);
}
