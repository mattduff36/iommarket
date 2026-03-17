import { cookies } from "next/headers";

const REVIEW_DEVICE_COOKIE = "iom_review_device_id";
const TWO_YEARS_IN_SECONDS = 60 * 60 * 24 * 365 * 2;

export async function getOrCreateReviewDeviceId() {
  const cookieStore = await cookies();
  const existing = cookieStore.get(REVIEW_DEVICE_COOKIE)?.value;
  if (existing) return existing;

  const deviceId = crypto.randomUUID();
  cookieStore.set(REVIEW_DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TWO_YEARS_IN_SECONDS,
    path: "/",
  });

  return deviceId;
}
