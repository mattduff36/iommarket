import { decodeListingText } from "./named-html";

/** Read an explicit label/value row, never a search filter or surrounding prose. */
export function labelledDetailValue(html: string, label: "Fuel Type" | "Transmission") {
  const pattern = '<span\\b[^>]*class=["\'][^"\']*\\btitle\\b[^"\']*["\'][^>]*>\\s*' +
    label + '\\s*</span>\\s*<strong\\b[^>]*>([\\s\\S]{0,160}?)</strong>';
  const match = html.match(new RegExp(pattern, "i"));
  return decodeListingText(match?.[1] ?? "") || null;
}
