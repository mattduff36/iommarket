import { createElement } from "react";
import { ImageResponse } from "next/og";
import { downloadSafeRemoteImage } from "@/lib/images/safe-remote-image";
import { isDatabaseSyncReference } from "@/lib/images/database-sync-reference";

// Staging database copies retain public production asset URLs; this grants no storage writes.
const PRODUCTION_PUBLIC_ASSET_ORIGIN = "https://snlqivvogfqesxpbjiei.supabase.co";

export function isAllowedDealerLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || (url.hash && !isDatabaseSyncReference(value))) return false;
    const storage = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url.origin === PRODUCTION_PUBLIC_ASSET_ORIGIN || (storage && url.origin === new URL(storage).origin)) {
      return url.pathname.startsWith("/storage/v1/object/public/user-avatars/");
    }
    const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    return Boolean(cloud && url.hostname === "res.cloudinary.com" &&
      (url.pathname.startsWith(`/${cloud}/image/upload/`) ||
        (isDatabaseSyncReference(value) && url.pathname.startsWith(`/${cloud}/image/private/`))));
  } catch {
    return false;
  }
}

export async function renderDealerSocialImage(name: string, logoUrl: string): Promise<ArrayBuffer> {
  if (!isAllowedDealerLogoUrl(logoUrl)) throw new Error("Dealer logo is not an approved image source.");
  const deliveryUrl = new URL(logoUrl);
  deliveryUrl.hash = "";
  const downloaded = await downloadSafeRemoteImage({ url: deliveryUrl.toString(), maxBytes: 5 * 1024 * 1024, timeoutMs: 5_000 });
  const image = `data:${downloaded.contentType};base64,${downloaded.bytes.toString("base64")}`;
  const response = new ImageResponse(
    createElement("div", { style: {
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "#ffffff", color: "#14213d", padding: "40px 60px",
    } },
    createElement("img", { src: image, alt: "", width: 1000, height: 380, style: { objectFit: "contain" } }),
    createElement("div", { style: { display: "flex", fontSize: 36, marginTop: 18, textAlign: "center" } }, name.slice(0, 100)),
    createElement("div", { style: { display: "flex", fontSize: 24, color: "#52627b", marginTop: 16 } }, "Find this dealer on iTrader.im")),
    { width: 1200, height: 630 },
  );
  // Consume the renderer here so decoding/render failures can use the shared-card fallback.
  return response.arrayBuffer();
}
