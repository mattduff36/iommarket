import { extractAutowebListings, nextAutowebPageUrl } from "./html-extract";
import type { ConnectorContext } from "./contract";
import { createWebsiteConnector, normalizeWebsiteVehicle } from "./website-source";
import type { CanonicalVehicle, SourceListResult } from "../types";

const base = createWebsiteConnector({
  key: "autoweb",
  detect({ url, html, requestUrls }) {
    const haystack = [url, html, ...(requestUrls ?? [])].join("\n").toLowerCase();
    return haystack.includes("autoweb");
  },
  requestMatch: (requestUrl) => /autoweb|stock|vehicle/i.test(requestUrl),
  extractHtml: extractAutowebListings,
});

export const autowebConnector = {
  ...base,
  async fetchDetails(_context: ConnectorContext, frozen: CanonicalVehicle[]) {
    return { vehicles: frozen, detailMissing: 0 };
  },
  async fetchList(context: ConnectorContext): Promise<SourceListResult> {
    const startUrl = context.source.startUrl;
    if (!startUrl) return base.fetchList(context);
    try {
      const { fetchPageHtml } = await import("../browse");
      const origin = new URL(startUrl).origin;
      const seen = new Set<string>();
      const raw: unknown[] = [];
      let url: string | null = startUrl;
      let pagesFetched = 0;
      while (url && pagesFetched < 20) {
        const html = await fetchPageHtml(url, context.fetchImpl);
        for (const card of extractAutowebListings(html, origin)) {
          const id = String(card.sourceVehicleId ?? card.id ?? "");
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          raw.push(card);
        }
        pagesFetched += 1;
        url = nextAutowebPageUrl(html, origin, pagesFetched);
      }
      const vehicles = raw
        .map((item) => normalizeWebsiteVehicle(item, context))
        .filter((item): item is CanonicalVehicle => item != null);
      if (vehicles.length > 0) {
        return {
          dealerKey: context.dealer.key,
          sourceKey: context.source.key,
          platform: "autoweb",
          status: "ok",
          error: null,
          startUrl,
          pagesFetched,
          advertisedCount: null,
          rawCount: vehicles.length,
          vehicles,
          rawRecords: raw,
        };
      }
    } catch {
      // fall through to shared website fetch
    }
    return base.fetchList(context);
  },
};
