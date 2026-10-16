import { TRADE_IMPORT_ROW_LIMIT } from "@/lib/trade-exchange/constants";
import { tradeListingSchema, type TradeListingInput } from "@/lib/trade-exchange/validation";

const HEADER = [
  "make",
  "model",
  "year",
  "mileage",
  "transmission",
  "fuel",
  "condition",
  "defects",
  "priceType",
  "priceGbp",
  "vat",
  "location",
  "notes",
] as const;

export interface TradeImportRow {
  line: number;
  input: TradeListingInput;
}

export interface TradeImportParse {
  rows: TradeImportRow[];
  errors: Array<{ line: number; message: string }>;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseTradeImport(csv: string): TradeImportParse {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows: TradeImportRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  if (lines.length === 0) return { rows, errors: [{ line: 1, message: "The file is empty." }] };
  const header = splitCsvLine(lines[0] ?? "").map((cell) => cell.toLowerCase());
  if (HEADER.some((column, index) => header[index] !== column.toLowerCase())) {
    return { rows, errors: [{ line: 1, message: `Use these columns: ${HEADER.join(",")}.` }] };
  }
  const body = lines.slice(1, TRADE_IMPORT_ROW_LIMIT + 2);
  if (lines.length - 1 > TRADE_IMPORT_ROW_LIMIT) {
    errors.push({ line: TRADE_IMPORT_ROW_LIMIT + 2, message: `Import up to ${TRADE_IMPORT_ROW_LIMIT} rows at a time.` });
  }
  body.slice(0, TRADE_IMPORT_ROW_LIMIT).forEach((line, index) => {
    const lineNumber = index + 2;
    const cells = splitCsvLine(line);
    const priceGbp = cells[9] ?? "";
    const parsed = tradeListingSchema.safeParse({
      make: cells[0],
      model: cells[1],
      year: cells[2],
      mileage: cells[3],
      transmission: cells[4],
      fuel: cells[5],
      conditionSummary: cells[6],
      disclosedDefects: cells[7],
      priceType: (cells[8] ?? "").toUpperCase(),
      pricePence: priceGbp ? Math.round(Number(priceGbp) * 100) : "",
      vatTreatment: (cells[10] ?? "").toUpperCase(),
      locationLabel: cells[11],
      notes: cells[12] ?? "",
      serviceHistory: "",
      motStatus: "",
      registrationNumber: "",
      vin: "",
      contactPreference: "MESSAGE",
      availabilityNote: "",
      ownershipDeclared: false,
      authorityDeclared: false,
      mileageDeclared: false,
      conditionDeclared: false,
      notWrittenOffDeclared: false,
      writeOff: "NONE",
    });
    if (!parsed.success) {
      errors.push({ line: lineNumber, message: parsed.error.issues[0]?.message ?? "This row is not valid." });
      return;
    }
    rows.push({ line: lineNumber, input: parsed.data });
  });
  return { rows, errors };
}
