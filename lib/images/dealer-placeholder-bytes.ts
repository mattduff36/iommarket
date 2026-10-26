import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDealerPlaceholderImage } from "./dealer-placeholder";

/** Never fetch or copy dealer placeholder artwork, including archived copies. */
export async function dealerPlaceholderBytes(sourceUrl: string) {
  if (!isDealerPlaceholderImage(sourceUrl)) return null;
  return {
    bytes: await readFile(path.join(process.cwd(), "public/images/placeholder-listing.png")),
    contentType: "image/png",
  };
}
