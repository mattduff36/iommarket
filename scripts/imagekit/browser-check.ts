import { readFileSync } from "node:fs";
import sharp from "sharp";
import { chromium, request } from "@playwright/test";

const base = "http://localhost:4010";
const liveListing = "cmuq5okrh00xtd4zjgqy2iffo";
const liveImage = "cmuq5oks200xud4zjao1nxchb";
const seedListing = "cmtncup5l005e38zjkegecodx";
const seedImage = "cmtnidqlw0000vwzjwrkjtbs7";
const focalListing = "cmuo1ogji000004l5iiynlfeq";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const report: Record<string, unknown> = {};

  const stored = JSON.parse(readFileSync("tmp/imagekit-admin-cookies.json", "utf8")) as Array<{
    name: string;
    value: string;
    options?: { path?: string; domain?: string; sameSite?: string; httpOnly?: boolean; secure?: boolean };
  }>;
  await page.context().addCookies(stored.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    url: base,
    httpOnly: cookie.options?.httpOnly,
    secure: false,
    sameSite: cookie.options?.sameSite === "strict" || cookie.options?.sameSite === "Strict"
      ? "Strict"
      : cookie.options?.sameSite === "none" || cookie.options?.sameSite === "None"
        ? "None"
        : "Lax",
  })));
  await page.goto(`${base}/api/me`, { waitUntil: "domcontentloaded" });
  report.me = await page.locator("body").innerText().then((text) => {
    const parsed = JSON.parse(text) as { role?: string };
    return parsed.role ?? "unknown";
  }).catch(() => "unreadable");

  async function inspect(name: string, path: string) {
    const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const html = await page.content();
    return {
      status: response?.status() ?? null,
      title: await page.title(),
      images: await page.locator("img").count(),
      photoApi: html.includes("/api/media/listing-photo"),
      unresolved: html.includes("media-unresolved") || html.includes("Unmapped image"),
      cloudinaryRef: html.includes("/api/media/cloudinary-ref"),
      cloudinaryHost: html.includes("res.cloudinary.com"),
    };
  }

  const imageResponses: string[] = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/media/") || url.includes("ik.imagekit.io") || url.includes("media-unresolved")) {
      imageResponses.push(`${response.status()} ${url.split("?")[0]}`);
    }
  });

  report.live = await inspect("live", `/listings/${liveListing}`);
  const acceptCookies = page.getByRole("button", { name: /accept all/i });
  if (await acceptCookies.isVisible({ timeout: 2000 }).catch(() => false)) await acceptCookies.click();
  const stage = page.getByTestId("listing-gallery-stage");
  const stagePainted = await stage.locator("img").evaluateAll((images) =>
    images.map((image) => ({
      width: (image as HTMLImageElement).naturalWidth,
      host: (() => {
        try { return new URL((image as HTMLImageElement).currentSrc).host; } catch { return "relative"; }
      })(),
    })),
  ).catch(() => []);
  report.stageImages = stagePainted;
  if (await stage.count()) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    await stage.screenshot({ path: "tmp/imagekit-listing-mobile.png" });
    report.mobileImageBox = await stage.boundingBox();
  }
  report.seed = await inspect("seed", `/listings/${seedListing}`);
  report.focal = await inspect("focal", `/listings/${focalListing}`);
  report.logo = await inspect("logo", `/dealers/preview-athol-garage`);

  const api = await request.newContext({ baseURL: base });
  const anon = await api.get(`/api/media/listing-photo?imageId=${liveImage}&source=listing&mode=fill&frame=card&w=320`);
  report.anonImageStatus = anon.status();

  const cookies = await page.context().cookies();
  const authed = await request.newContext({ baseURL: base, storageState: { cookies, origins: [] } });
  const signed = await authed.get(`/api/media/listing-photo?imageId=${liveImage}&source=listing&mode=fill&frame=card&w=320`, { maxRedirects: 0 });
  const location = signed.headers().location ?? "";
  report.signedStatus = signed.status();
  report.signedHost = location ? new URL(location).host : null;
  report.signedHasSignature = location.includes("ik-s=") && location.includes("ik-t=");
  if (location) {
    const delivered = await api.get(location);
    report.deliveredStatus = delivered.status();
    report.deliveredType = delivered.headers()["content-type"] ?? null;
  }
  const social = await authed.get(`/api/media/social/${liveListing}`, { maxRedirects: 0 });
  const socialLocation = social.headers().location ?? "";
  report.socialStatus = social.status();
  report.socialHost = socialLocation ? new URL(socialLocation).host : null;
  if (socialLocation.startsWith("http")) {
    const socialImage = await api.get(socialLocation);
    report.socialDelivered = socialImage.status();
    report.socialType = socialImage.headers()["content-type"] ?? null;
    const meta = await sharp(Buffer.from(await socialImage.body())).metadata();
    report.socialWidth = meta.width ?? null;
    report.socialHeight = meta.height ?? null;
  }
  const seedMedia = await authed.get(
    `/api/media/listing-photo?imageId=${seedImage}&source=listing&mode=fill&frame=card&w=320`,
    { maxRedirects: 0 },
  );
  report.seedMediaStatus = seedMedia.status();
  report.seedMediaTarget = (seedMedia.headers().location ?? "").split("?")[0];
  const forgedLogo = await api.get(
    `/api/media/cloudinary-ref?url=${encodeURIComponent("https://res.cloudinary.com/example/image/private/v1/iommarket/listings/not-a-logo.jpg")}`,
    { maxRedirects: 0 },
  );
  report.forgedLogoStatus = forgedLogo.status();
  report.observedMedia = [...new Set(imageResponses)].slice(0, 20);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "browser check failed");
  process.exit(1);
});
