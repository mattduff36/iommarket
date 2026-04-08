import { fetchWithTimeout } from "@/lib/services/http";
import { normalizeRegistration } from "@/lib/utils/registration";

const EASY_LIVE_BASE_URL = "https://www.easyliveauction.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface AuctionHistoryEntry {
  source: string;
  saleTitle: string;
  saleUrl: string;
  lotUrl: string;
  lotNumber: string | null;
  saleDate: string | null;
  hammerPrice: number | null;
  lotTitle: string;
  registrationSnippet: string | null;
}

export interface AuctionHistoryApiService {
  getAuctionHistory(registrationNumber: string): Promise<AuctionHistoryEntry[]>;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2f;/g, "/")
    .replace(/&#x3a;/g, ":")
    .replace(/&#x21;/g, "!")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirst(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }
  return null;
}

function extractLotLinks(html: string): string[] {
  const matches = html.matchAll(/href="(\/catalogue\/lot\/[^"]+)"/gi);
  return [...new Set([...matches].map((match) => match[1]))];
}

function extractHammerPrice(html: string): number | null {
  const match = html.match(
    /Hammer Price[\s\S]{0,300}?(?:£|&pound;)\s*([\d,]+(?:\.\d{2})?)/i
  );
  if (!match?.[1]) return null;

  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isNaN(amount) ? null : amount;
}

function extractSaleUrl(html: string): string | null {
  const match = html.match(
    /href="(\/catalogue\/(?!lot\/)[^"]+)"[^>]*>[^<]+<\/a><\/span>\s*<span class="fa fa-angle-right"/i
  );
  return match?.[1] ? `${EASY_LIVE_BASE_URL}${match[1]}` : null;
}

function containsRegistration(pageHtml: string, registrationNumber: string): boolean {
  const normalizedPageText = pageHtml.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalizedPageText.includes(normalizeRegistration(registrationNumber));
}

export function createAuctionHistoryApiService(): AuctionHistoryApiService {
  return {
    async getAuctionHistory(registrationNumber: string) {
      const normalizedRegistration = normalizeRegistration(registrationNumber);
      if (!normalizedRegistration) return [];

      const results: AuctionHistoryEntry[] = [];
      const searchResponse = await fetchWithTimeout(
        `${EASY_LIVE_BASE_URL}/catalogue/?searchTerm=${encodeURIComponent(
          normalizedRegistration
        )}&searchOption=3&sortBy=lotnumber&currentPage=1`,
        {
          headers: {
            "User-Agent": USER_AGENT,
          },
          cache: "no-store",
        }
      );

      if (!searchResponse.ok) {
        return [];
      }

      const searchHtml = await searchResponse.text();
      const lotLinks = extractLotLinks(searchHtml).slice(0, 6);
      if (lotLinks.length === 0) {
        return [];
      }

      const lotPages = await Promise.all(
        lotLinks.map(async (lotLink) => {
          try {
            const response = await fetchWithTimeout(
              `${EASY_LIVE_BASE_URL}${lotLink}`,
              {
                headers: {
                  "User-Agent": USER_AGENT,
                },
                cache: "no-store",
              }
            );

            if (!response.ok) return null;
            return {
              lotUrl: `${EASY_LIVE_BASE_URL}${lotLink}`,
              html: await response.text(),
            };
          } catch {
            return null;
          }
        })
      );

      for (const lotPage of lotPages) {
        if (!lotPage) continue;
        if (!lotPage.html.includes("Chrystals Auctions")) continue;
        if (!containsRegistration(lotPage.html, normalizedRegistration)) continue;

        const saleTitle =
          extractFirst(lotPage.html, [
            /Sale Details\s*-\s*([^<]+)/i,
            /<title>([^<]+)<\/title>/i,
          ]) ?? "Chrystals Auctions vehicle sale";

        results.push({
          source: "Chrystals Auctions via Easy Live Auction",
          saleTitle,
          saleUrl: extractSaleUrl(lotPage.html) ?? lotPage.lotUrl,
          lotUrl: lotPage.lotUrl,
          lotNumber:
            extractFirst(lotPage.html, [
              /<span><a [^>]*>Lot\s+([^<]+)<\/a><\/span>/i,
              /Lot\s+(\d+)/i,
            ]) ?? null,
          saleDate:
            extractFirst(lotPage.html, [
              /Sale Dates:\s*([^<]+)/i,
              /(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
            ]) ?? null,
          hammerPrice: extractHammerPrice(lotPage.html),
          lotTitle:
            extractFirst(lotPage.html, [
              /<meta property="og:title" content="([^"]+)"/i,
              /<h1[^>]*>([\s\S]*?)<\/h1>/i,
              /<title>([^<]+)<\/title>/i,
            ]) ?? "Vehicle lot",
          registrationSnippet:
            extractFirst(lotPage.html, [
              new RegExp(`([^<]{0,40}${normalizedRegistration}[^<]{0,40})`, "i"),
            ]) ?? normalizedRegistration,
        });
      }

      return results;
    },
  };
}
