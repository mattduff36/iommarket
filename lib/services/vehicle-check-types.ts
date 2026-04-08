export type LookupSourceId = "dvla" | "mot" | "iom" | "auction";

export interface VehicleLookupSourceNote {
  id: LookupSourceId;
  label: string;
  detail: string;
}

export interface VehicleRecord {
  registrationNumber: string;
  displayRegistrationNumber: string;
  lookupPath: "uk" | "iom";
  make: string | null;
  model: string | null;
  colour: string | null;
  fuelType: string | null;
  taxStatus: string | null;
  taxDueDate: string | null;
  motStatus: string | null;
  motExpiryDate: string | null;
  yearOfManufacture: number | null;
  engineSizeCc: number | null;
  co2Emissions: number | null;
  monthOfFirstRegistration: string | null;
  wheelPlan: string | null;
  euroStatus: string | null;
  category: string | null;
  previousUkRegistration: string | null;
  dateOfFirstRegistrationIom: string | null;
  roadTax12Month: string | null;
  roadTax6Month: string | null;
  firstUsedDate: string | null;
}

export interface VehicleMotDefect {
  text: string;
  type: string;
  dangerous: boolean;
}

export interface VehicleMotTest {
  completedDate: string;
  testResult: string;
  expiryDate: string | null;
  odometerValue: number | null;
  odometerUnit: "mi" | "km" | null;
  motTestNumber: string | null;
  defects: VehicleMotDefect[];
}

export interface VehicleMileagePoint {
  date: string;
  mileage: number;
}

export interface VehicleMileageSummary {
  latestMileage: number | null;
  latestMileageDate: string | null;
  earliestMileage: number | null;
  earliestMileageDate: string | null;
  averageAnnualMileage: number | null;
  points: VehicleMileagePoint[];
}

export interface VehicleMotHistory {
  registrationNumber: string;
  sourceRegistrationNumber: string | null;
  make: string | null;
  model: string | null;
  firstUsedDate: string | null;
  fuelType: string | null;
  primaryColour: string | null;
  motTests: VehicleMotTest[];
  motExpiryDate: string | null;
  motStatus: string | null;
  lastTestDate: string | null;
  lastTestResult: string | null;
}

export interface VehicleAuctionEntry {
  source: string;
  saleTitle: string;
  saleUrl: string;
  lotUrl: string;
  lotNumber: string | null;
  saleDate: string | null;
  hammerPrice: number | null;
  lotTitle: string;
  registrationSnippet: string | null;
}

export interface VehicleAuctionHistory {
  entries: VehicleAuctionEntry[];
  sourceLabel: string;
}

export interface VehicleCheckResult {
  normalizedRegistration: string;
  displayRegistration: string;
  isManx: boolean;
  lookupTargetRegistration: string;
  vehicle: VehicleRecord | null;
  motHistory: VehicleMotHistory | null;
  mileage: VehicleMileageSummary | null;
  auctionHistory: VehicleAuctionHistory | null;
  warnings: string[];
  sourceNotes: VehicleLookupSourceNote[];
  checkedAt: string;
}

export interface VehicleCheckResponse {
  success: true;
  result: VehicleCheckResult;
}
