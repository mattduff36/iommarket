export const MEDIA_DENIAL_SOURCES = ["shared-window", "local-window", "bucket-cap"] as const;
export type MediaDenialSource = typeof MEDIA_DENIAL_SOURCES[number];
export const MEDIA_RATE_LIMIT_TIMING = "itrader-media-limit";
