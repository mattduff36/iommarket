const LOCAL_BASE_URL = "http://localhost:3000";

export interface BreadcrumbEntry {
  label: string;
  href: string;
}

interface BreadcrumbListJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
}

export function getCanonicalBaseUrl(
  configuredUrl = process.env.NEXT_PUBLIC_APP_URL,
  environment = process.env.NODE_ENV,
  vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL,
): URL {
  let candidate = configuredUrl?.trim();
  let source = "NEXT_PUBLIC_APP_URL";
  if (!candidate) {
    if (environment === "production") {
      const vercelHost = vercelProductionHost?.trim();
      if (!vercelHost) {
        throw new Error(
          "Canonical origin unavailable in production: set NEXT_PUBLIC_APP_URL or VERCEL_PROJECT_PRODUCTION_URL.",
        );
      }
      candidate = /^https?:\/\//i.test(vercelHost)
        ? vercelHost
        : `https://${vercelHost}`;
      source = "VERCEL_PROJECT_PRODUCTION_URL";
    } else {
      return new URL(LOCAL_BASE_URL);
    }
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new Error(`${source} must be a valid absolute URL.`, {
      cause: error,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${source} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new Error(`${source} must not include credentials.`);
  }
  if (url.pathname !== "/") {
    throw new Error(`${source} must not include a path.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${source} must not include query or hash data.`);
  }

  return url;
}

export function buildCanonicalUrl(
  href: string,
  baseUrl = getCanonicalBaseUrl(),
): string {
  if (
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(href)
  ) {
    throw new Error("Canonical paths must be root-relative.");
  }

  const url = new URL(href, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error("Canonical paths must stay on the configured origin.");
  }
  return url.toString();
}

export function buildBreadcrumbListJsonLd(
  entries: readonly BreadcrumbEntry[],
  baseUrl = getCanonicalBaseUrl(),
): BreadcrumbListJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.label,
      item: buildCanonicalUrl(entry.href, baseUrl),
    })),
  };
}

export function serializeJsonLd(value: unknown): string {
  let serialized: string;
  try {
    const result = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (
        nestedValue === undefined ||
        typeof nestedValue === "function" ||
        typeof nestedValue === "symbol" ||
        typeof nestedValue === "bigint"
      ) {
        throw new TypeError("JSON-LD values must be JSON-serializable.");
      }
      return nestedValue;
    });
    if (result === undefined) {
      throw new TypeError("JSON-LD values must be JSON-serializable.");
    }
    serialized = result;
  } catch (error) {
    throw new Error("Failed to serialize JSON-LD.", { cause: error });
  }

  return serialized
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
