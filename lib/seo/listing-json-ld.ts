export interface ListingStructuredAttribute {
  slug: string;
  value: string;
}

export interface ListingStructuredSeller {
  kind: "dealer" | "private";
  name: string;
  url?: string;
}

const CONDITION_URLS: Record<string, string> = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
};

export function buildListingProductJsonLd(input: {
  id: string;
  url: string;
  name: string;
  description: string;
  images: string[];
  price: number;
  currency: "GBP";
  availability: "https://schema.org/InStock" | "https://schema.org/SoldOut";
  attributes?: ListingStructuredAttribute[];
  seller?: ListingStructuredSeller | null;
}) {
  const attribute = (slug: string) =>
    input.attributes?.find((item) => item.slug === slug)?.value?.trim() || undefined;
  const conditionKey = attribute("condition")?.toLowerCase();
  const itemCondition = conditionKey ? CONDITION_URLS[conditionKey] : undefined;
  const brand = attribute("make");
  const model = attribute("model");
  const seller = input.seller?.name
    ? input.seller.kind === "dealer"
      ? {
          "@type": "AutoDealer",
          name: input.seller.name,
          ...(input.seller.url ? { url: input.seller.url } : {}),
        }
      : { "@type": "Person", name: input.seller.name }
    : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${input.url}#product`,
    name: input.name,
    description: input.description,
    ...(input.images.length > 0 ? { image: input.images } : {}),
    ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
    ...(model ? { model } : {}),
    ...(itemCondition ? { itemCondition } : {}),
    offers: {
      "@type": "Offer",
      url: input.url,
      price: input.price,
      priceCurrency: input.currency,
      availability: input.availability,
      ...(seller ? { seller } : {}),
    },
  };
}

export function buildSiteIdentityJsonLd(origin: string) {
  const site = origin.endsWith("/") ? origin : `${origin}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: "iTrader.im",
        url: site,
        logo: `${origin}/og/itrader-social.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: "iTrader.im",
        url: site,
        publisher: { "@id": `${origin}/#organization` },
      },
    ],
  };
}

export function buildDealerJsonLd(input: { name: string; url: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "AutoDealer",
    "@id": `${input.url}#dealer`,
    name: input.name,
    url: input.url,
    description: input.description,
  };
}
