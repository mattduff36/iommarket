const PRICE = /(?:£|&pound;|GBP)\s*[\d,]{3,7}/i;
const YEAR = /\b(19|20)\d{2}\b/;
const MAKE =
  /\b(audi|bmw|ford|honda|toyota|nissan|vauxhall|volkswagen|vw|mercedes|mini|kia|hyundai|peugeot|renault|citroen|skoda|seat|volvo|jaguar|land rover|lexus|suzuki|fiat|mazda|jeep|mg|tesla|porsche|mitsubishi|dacia|cupra|maxus|jaecoo)\b/i;

export function countPriceLikeCards(html: string) {
  const samples: string[] = [];
  const seen = new Set<string>();
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const matcher = new RegExp(PRICE.source, "gi");
  let match = matcher.exec(text);
  while (match) {
    const start = Math.max(0, match.index - 120);
    const window = text.slice(start, match.index + match[0].length + 80).trim();
    const priceKey = match[0].replace(/\s+/g, "");
    if (!seen.has(priceKey) && (YEAR.test(window) || MAKE.test(window))) {
      seen.add(priceKey);
      samples.push(window.slice(0, 160));
    }
    match = matcher.exec(text);
  }
  return { count: samples.length, samples: samples.slice(0, 8) };
}

export function detectBlockedPage(input: { title: string; html: string; status: number | null }) {
  const haystack = `${input.title}\n${input.html}`.toLowerCase();
  if (input.status === 401 || input.status === 403) return "blocked_requires_feed";
  if (/captcha|cloudflare|attention required|access denied|just a moment/.test(haystack)) {
    return "blocked_requires_feed";
  }
  return null;
}

export function detectFacebookRedirect(url: string) {
  try {
    return /facebook\.com$/i.test(new URL(url).hostname) || /facebook\.com\//i.test(url);
  } catch {
    return false;
  }
}
