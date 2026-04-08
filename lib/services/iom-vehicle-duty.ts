interface DutyBand {
  minCo2: number;
  maxCo2: number;
  duty12Month: number;
  duty6Month: number;
}

interface EngineDutyBand {
  minCc: number;
  maxCc: number;
  duty12Month: number;
  duty6Month: number;
}

const IOM_CO2_BANDS: DutyBand[] = [
  { minCo2: 0, maxCo2: 0, duty12Month: 65, duty6Month: 39 },
  { minCo2: 1, maxCo2: 50, duty12Month: 65, duty6Month: 39 },
  { minCo2: 51, maxCo2: 75, duty12Month: 65, duty6Month: 39 },
  { minCo2: 76, maxCo2: 100, duty12Month: 65, duty6Month: 39 },
  { minCo2: 101, maxCo2: 110, duty12Month: 65, duty6Month: 39 },
  { minCo2: 111, maxCo2: 120, duty12Month: 79, duty6Month: 46 },
  { minCo2: 121, maxCo2: 130, duty12Month: 169, duty6Month: 91 },
  { minCo2: 131, maxCo2: 140, duty12Month: 203, duty6Month: 108 },
  { minCo2: 141, maxCo2: 150, duty12Month: 235, duty6Month: 124 },
  { minCo2: 151, maxCo2: 165, duty12Month: 268, duty6Month: 140 },
  { minCo2: 166, maxCo2: 175, duty12Month: 302, duty6Month: 157 },
  { minCo2: 176, maxCo2: 185, duty12Month: 336, duty6Month: 174 },
  { minCo2: 186, maxCo2: 200, duty12Month: 394, duty6Month: 203 },
  { minCo2: 201, maxCo2: 225, duty12Month: 410, duty6Month: 211 },
  { minCo2: 226, maxCo2: 255, duty12Month: 700, duty6Month: 356 },
  { minCo2: 256, maxCo2: Number.POSITIVE_INFINITY, duty12Month: 724, duty6Month: 368 },
];

const IOM_ENGINE_BANDS: EngineDutyBand[] = [
  { minCc: 0, maxCc: 1000, duty12Month: 65, duty6Month: 39 },
  { minCc: 1001, maxCc: 1200, duty12Month: 130, duty6Month: 71 },
  { minCc: 1201, maxCc: 1800, duty12Month: 203, duty6Month: 108 },
  { minCc: 1801, maxCc: 2500, duty12Month: 288, duty6Month: 150 },
  { minCc: 2501, maxCc: 3500, duty12Month: 467, duty6Month: 240 },
  { minCc: 3501, maxCc: 5000, duty12Month: 576, duty6Month: 294 },
  { minCc: 5001, maxCc: Number.POSITIVE_INFINITY, duty12Month: 612, duty6Month: 312 },
];

const VETERAN_DUTY_POUNDS = 28;
const CO2_CUTOFF_DATE = new Date("2010-04-01");

export interface IomDutyResult {
  duty12Month: string;
  duty6Month: string;
}

function parseRegistrationDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fullUkDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fullUkDate) {
    return new Date(
      Number.parseInt(fullUkDate[3], 10),
      Number.parseInt(fullUkDate[2], 10) - 1,
      Number.parseInt(fullUkDate[1], 10)
    );
  }

  const shortUkDate = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (shortUkDate) {
    return new Date(
      Number.parseInt(shortUkDate[2], 10),
      Number.parseInt(shortUkDate[1], 10) - 1,
      1
    );
  }

  const yearOnly = trimmed.match(/(\d{4})/);
  if (yearOnly) {
    return new Date(Number.parseInt(yearOnly[1], 10), 0, 1);
  }

  return null;
}

export function calculateIomVehicleDuty(options: {
  co2Emissions?: number | null;
  engineSizeCc?: number | null;
  yearOfManufacture?: number | null;
  firstRegistrationDate?: string | null;
}): IomDutyResult | null {
  const { co2Emissions, engineSizeCc, yearOfManufacture, firstRegistrationDate } =
    options;

  if (yearOfManufacture) {
    const vehicleAge = new Date().getFullYear() - yearOfManufacture;
    if (vehicleAge >= 30) {
      return {
        duty12Month: `£${VETERAN_DUTY_POUNDS}`,
        duty6Month: "N/A",
      };
    }
  }

  const registrationDate = parseRegistrationDate(firstRegistrationDate);
  const shouldUseEngineBands =
    registrationDate !== null && registrationDate < CO2_CUTOFF_DATE;

  if (shouldUseEngineBands && engineSizeCc && engineSizeCc > 0) {
    const band = IOM_ENGINE_BANDS.find(
      (entry) => engineSizeCc >= entry.minCc && engineSizeCc <= entry.maxCc
    );

    if (band) {
      return {
        duty12Month: `£${band.duty12Month}`,
        duty6Month: `£${band.duty6Month}`,
      };
    }
  }

  if (co2Emissions !== null && co2Emissions !== undefined) {
    const band = IOM_CO2_BANDS.find(
      (entry) =>
        co2Emissions >= entry.minCo2 && co2Emissions <= entry.maxCo2
    );

    if (band) {
      return {
        duty12Month: `£${band.duty12Month}`,
        duty6Month: `£${band.duty6Month}`,
      };
    }
  }

  if (engineSizeCc && engineSizeCc > 0) {
    const band = IOM_ENGINE_BANDS.find(
      (entry) => engineSizeCc >= entry.minCc && engineSizeCc <= entry.maxCc
    );

    if (band) {
      return {
        duty12Month: `£${band.duty12Month}`,
        duty6Month: `£${band.duty6Month}`,
      };
    }
  }

  return null;
}
