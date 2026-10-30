import { decodeListingText } from "./named-html";

/** SNCC's vehicle overview is separate from the page's finance/contact forms. */
export function extractSnccOverview(html: string) {
  const section = html.match(/<div\b[^>]*\bid=["']tab-overview["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!section) return null;
  const description = decodeListingText(section
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")).slice(0, 4000);
  if (!description) return null;
  // This explicit introduction identifies the vehicle; unrelated footer copy
  // and contact-form words never establish its type.
  const introduction = description.slice(0, 250);
  const vehicleType = /SkillanNaylor\s+Car\s*\(motorcycle\)\s+Company/i.test(introduction)
    ? "motorcycle" : /\bthis\s+(?:[a-z-]+\s+){0,3}pick[ -]?up\b/i.test(description) ? "van" : null;
  return { description, vehicleType };
}
