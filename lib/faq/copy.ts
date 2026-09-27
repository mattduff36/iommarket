import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import { LISTING_DURATION_DAYS } from "@/lib/listing-status";
import {
  FEATURED_LISTING_PHOTO_LIMIT,
  PRIVATE_LISTING_PHOTO_LIMIT,
} from "@/lib/listings/photo-limits";
import type { FaqTextPart } from "@/lib/faq/types";

export const starterListingCap = getDealerListingCap("STARTER");
export const proListingCap = getDealerListingCap("PRO");
export { LISTING_DURATION_DAYS, FEATURED_LISTING_PHOTO_LIMIT, PRIVATE_LISTING_PHOTO_LIMIT };

export function text(value: string): FaqTextPart {
  return { kind: "text", value };
}

export function link(href: string, label: string): FaqTextPart {
  return { kind: "link", href, label };
}

export const supportEmail = link("mailto:hello@itrader.im", "hello@itrader.im");
