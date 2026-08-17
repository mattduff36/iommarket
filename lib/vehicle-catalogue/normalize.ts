const WHITESPACE = /\s+/g;
const NON_ALPHANUMERIC = /[^a-z0-9]/g;

export function cleanCatalogueName(value: string): string {
  return value.trim().replace(WHITESPACE, " ");
}

export function normalizeCatalogueName(value: string): string {
  return cleanCatalogueName(value).toLowerCase().replace(NON_ALPHANUMERIC, "");
}

export function isManualCatalogueValue(value: string): boolean {
  return normalizeCatalogueName(value).length > 0;
}
