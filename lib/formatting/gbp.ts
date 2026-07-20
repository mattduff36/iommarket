const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGbpFromPence(pence: number): string {
  if (!Number.isSafeInteger(pence) || pence < 0) {
    throw new Error("GBP amounts must be non-negative integer pence.");
  }

  return GBP_FORMATTER.format(pence / 100);
}

export function formatGbpInputFromPence(pence: number): string {
  if (!Number.isSafeInteger(pence) || pence < 0) {
    throw new Error("GBP amounts must be non-negative integer pence.");
  }

  return (pence / 100).toFixed(2);
}

export function parseGbpInputToPence(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a GBP amount with up to two decimal places.");
  }

  const [pounds, decimal = ""] = normalized.split(".");
  const pence = Number.parseInt(pounds, 10) * 100 +
    Number.parseInt(decimal.padEnd(2, "0"), 10);

  if (!Number.isSafeInteger(pence)) {
    throw new Error("GBP amount is too large.");
  }

  return pence;
}
