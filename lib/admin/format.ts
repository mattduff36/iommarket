export function formatAdminDate(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toLocaleDateString("en-GB");
}

export function formatAdminPounds(pence: number, fractionDigits = 0) {
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}
