import type { Metadata } from "next";
import type { RuntimeEnv } from "@/lib/runtime-env";
import { isSearchIndexingEnabled } from "@/lib/seo/indexing-policy";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

export const DEFAULT_SOCIAL_IMAGE_PATH = "/og/itrader-social.png";
export const DEFAULT_SOCIAL_IMAGE_WIDTH = 1200;
export const DEFAULT_SOCIAL_IMAGE_HEIGHT = 630;
export const DEFAULT_SOCIAL_IMAGE_ALT = "iTrader.im, the Isle of Man vehicle marketplace";

export interface SocialImage {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

export function defaultSocialImage(alt = DEFAULT_SOCIAL_IMAGE_ALT): SocialImage {
  return {
    url: DEFAULT_SOCIAL_IMAGE_PATH,
    width: DEFAULT_SOCIAL_IMAGE_WIDTH,
    height: DEFAULT_SOCIAL_IMAGE_HEIGHT,
    alt,
  };
}

export function publicHttpsImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolvePageRobots(
  pageIndex: boolean,
  follow = true,
  env: RuntimeEnv = process.env,
  now = Date.now(),
) {
  return {
    index: pageIndex && isSearchIndexingEnabled(env, now),
    follow,
  };
}

export function publicPageMetadata(input: {
  title?: string;
  description: string;
  path: string;
  image?: SocialImage | null;
  index?: boolean;
  follow?: boolean;
  env?: RuntimeEnv;
  now?: number;
}): Metadata {
  const image = input.image === null ? undefined : input.image ?? defaultSocialImage();
  const canonical = buildCanonicalUrl(input.path);
  return {
    ...(input.title ? { title: input.title } : {}),
    description: input.description,
    alternates: { canonical },
    robots: resolvePageRobots(input.index !== false, input.follow !== false, input.env, input.now),
    openGraph: {
      ...(input.title ? { title: input.title } : {}),
      description: input.description,
      url: canonical,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      ...(input.title ? { title: input.title } : {}),
      description: input.description,
      ...(image ? { images: [image.url] } : {}),
    },
  };
}
