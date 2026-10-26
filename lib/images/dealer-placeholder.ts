/** Shared by every dealer connector, review and managed stock-image import. */
export const DEALER_PLACEHOLDER_PATH = "/images/placeholder-listing.png";
const PLACEHOLDER = /(?:^|[^a-z0-9])(?:placeholder(?:[-_ ]?(?:car|vehicle|image|photo))?|no[-_ ]?(?:image|photo|pic)(?:ture)?s?|(?:images?|photos?|pictures?)[-_ ]?(?:coming[-_ ]?soon|unavailable|missing)|coming[-_ ]?soon|(?:awaiting|waiting[-_ ]?for)[-_ ]?(?:image|photo|picture)s?|default[-_ ]?(?:image|photo|vehicle)|(?:image|photo)[-_ ]?not[-_ ]?available)(?:[^a-z0-9]|$)/i;

export function isDealerPlaceholderImage(value: string): boolean {
  try {
    const url = new URL(value.startsWith("//") ? "https:" + value : value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    let path = decodeURIComponent(url.pathname);
    if (url.hostname.toLowerCase() === "images.netdirector.auto") {
      const token = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      if (token.length > 8192) return false;
      const decoded = JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
      if (typeof decoded?.key === "string") path = decoded.key;
    }
    return PLACEHOLDER.test(path);
  } catch { return false; }
}
