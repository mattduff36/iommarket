const IOM_PATTERNS = [
  /^([A-Z])MN\s*\d+\s*[A-Z]?$/i,
  /^MAN\s*\d+\s*[A-Z]?$/i,
  /^[A-Z]\d+\s*MAN$/i,
  /^MANX\s*\d+\s*[A-Z]?$/i,
  /^MN\s*\d+\s*[A-Z]?$/i,
  /^\d+-MN-\d+$/i,
  /^\d+\s*[A-Z]?MN[A-Z]?$/i,
  /^\d+\s*MAN$/i,
  /^[A-Z]{1,2}MN\s*\d+\s*[A-Z]?$/i,
];

const UK_PATTERNS = [
  /^[A-Z]{2}\d{2}[A-Z]{3}$/i,
  /^[A-Z]\d{1,3}[A-Z]{3}$/i,
  /^[A-Z]{3}\d{1,3}[A-Z]$/i,
  /^[A-Z]{1,3}\d{1,4}$/i,
  /^\d{1,4}[A-Z]{1,3}$/i,
];

export function formatRegistrationForApi(registration: string): string {
  return registration.replace(/[\s-]+/g, "").trim().toUpperCase();
}

export function normalizeRegistration(registration: string): string {
  return formatRegistrationForApi(registration);
}

export function isManxRegistration(registration: string): boolean {
  const normalized = registration.toUpperCase().replace(/[\s-]+/g, " ").trim();
  return IOM_PATTERNS.some(
    (pattern) =>
      pattern.test(normalized) || pattern.test(normalized.replace(/\s+/g, ""))
  );
}

export function isUkRegistration(registration: string): boolean {
  const clean = normalizeRegistration(registration);
  return UK_PATTERNS.some((pattern) => pattern.test(clean));
}

export function isSupportedVehicleRegistration(registration: string): boolean {
  return isManxRegistration(registration) || isUkRegistration(registration);
}

export function getRegistrationRegion(registration: string) {
  const trimmed = registration.trim();

  if (!trimmed) {
    return "unrecognized";
  }

  if (isManxRegistration(trimmed)) {
    return "iom";
  }

  if (isUkRegistration(trimmed)) {
    return "uk";
  }

  return "unrecognized";
}

export function formatUkRegistrationForDisplay(registration: string): string {
  const clean = normalizeRegistration(registration);

  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(clean)) {
    return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  }

  const prefixMatch = clean.match(/^([A-Z])(\d{1,3})([A-Z]{3})$/);
  if (prefixMatch) {
    return `${prefixMatch[1]}${prefixMatch[2]} ${prefixMatch[3]}`;
  }

  const suffixMatch = clean.match(/^([A-Z]{3})(\d{2,3})([A-Z])$/);
  if (suffixMatch) {
    return `${suffixMatch[1]} ${suffixMatch[2]}${suffixMatch[3]}`;
  }

  const datelessLettersFirst = clean.match(/^([A-Z]{1,3})(\d{1,4})$/);
  if (datelessLettersFirst) {
    return `${datelessLettersFirst[1]} ${datelessLettersFirst[2]}`;
  }

  const datelessNumbersFirst = clean.match(/^(\d{1,4})([A-Z]{1,3})$/);
  if (datelessNumbersFirst) {
    return `${datelessNumbersFirst[1]} ${datelessNumbersFirst[2]}`;
  }

  if (clean.length > 4) {
    return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  }

  return clean;
}

export function formatIomRegistrationForDisplay(registration: string): string {
  const clean = normalizeRegistration(registration);

  const numericManMatch = clean.match(/^(\d+)(MAN)$/);
  if (numericManMatch) {
    return `${numericManMatch[1]} ${numericManMatch[2]}`;
  }

  const manSuffixMatch = clean.match(/^([A-Z]\d+)(MAN)$/);
  if (manSuffixMatch) {
    return `${manSuffixMatch[1]} ${manSuffixMatch[2]}`;
  }

  const simpleMatch = clean.match(/^([A-Z]+)(\d+)([A-Z]?)$/);
  if (simpleMatch) {
    const [, letters, numbers, suffix] = simpleMatch;
    return suffix ? `${letters} ${numbers} ${suffix}` : `${letters} ${numbers}`;
  }

  const modernMatch = clean.match(/^(\d+)([A-Z]?MN[A-Z]?)$/);
  if (modernMatch) {
    return `${modernMatch[1]} ${modernMatch[2]}`;
  }

  return clean;
}

export function formatRegistrationForDisplay(registration: string): string {
  return isManxRegistration(registration)
    ? formatIomRegistrationForDisplay(registration)
    : formatUkRegistrationForDisplay(registration);
}

export function formatIomRegistrationForApi(registration: string): string {
  const clean = normalizeRegistration(registration);

  const numericManMatch = clean.match(/^(\d+)(MAN)$/);
  if (numericManMatch) {
    return `${numericManMatch[1]}-${numericManMatch[2]}`;
  }

  const manSuffixMatch = clean.match(/^([A-Z]\d+)(MAN)$/);
  if (manSuffixMatch) {
    return `${manSuffixMatch[1]}-${manSuffixMatch[2]}`;
  }

  const standardMatch = clean.match(/^([A-Z]+)(\d+)([A-Z]?)$/);
  if (standardMatch) {
    const [, letters, numbers, suffix] = standardMatch;
    return suffix ? `${letters}-${numbers}-${suffix}` : `${letters}-${numbers}`;
  }

  const modernMatch = clean.match(/^(\d+)(MN)(\d+)$/);
  if (modernMatch) {
    return `${modernMatch[1]}-${modernMatch[2]}-${modernMatch[3]}`;
  }

  return clean;
}
