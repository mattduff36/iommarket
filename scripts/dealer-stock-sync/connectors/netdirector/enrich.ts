import { vehicleIdentityToken } from "./normalize";

export function applyDetailEnrichment<T extends { make: string; model: string; year: number | null; mileage: number | null }>(
  frozen: T[],
  detailsByToken: Map<string, T>,
  tokenFor: (item: T) => string = (item) => vehicleIdentityToken(item),
  merge: (card: T, detail: T) => T = (card, detail) => ({ ...card, ...detail }),
) {
  const frozenTokens = new Set(frozen.map((vehicle) => tokenFor(vehicle)));
  const extraTokens = [...detailsByToken.keys()].filter((token) => !frozenTokens.has(token));
  if (extraTokens.length > 0) {
    throw new Error(`Detail phase introduced new vehicles: ${extraTokens.join(", ")}`);
  }

  let detailMissing = 0;
  const enriched: T[] = [];
  for (const card of frozen) {
    const detail = detailsByToken.get(tokenFor(card));
    if (!detail) {
      const mappable = Boolean(card.make && card.model && card.year != null && card.mileage != null);
      if (!mappable) detailMissing += 1;
      enriched.push(card);
      continue;
    }
    enriched.push(merge(card, detail));
  }
  return { vehicles: enriched, detailMissing };
}
