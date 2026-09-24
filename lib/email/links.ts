import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";

export function getEmailAppOrigin(): string {
  return getCanonicalBaseUrl().origin;
}
