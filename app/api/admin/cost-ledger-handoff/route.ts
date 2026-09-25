import { constants, publicEncrypt } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { isCostOwner } from "@/lib/costs/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDOFF_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy2jZhQXQlQ7i+T24V2rs
fWVw5A/UatgSPnbjmJhqKmWHmxrkPOoGBpa6ECRqe+SlJzP5tdBql2yCkhmdFFol
iOQn0gWDWR7ERLq87D5zi3mCY5TcGvlH3Pf8gnoRagCzfkiR0c96XUOnWhbyawIf
4vX/SjLA5Rv8zv07havk0v6YYBjmyn7KhMFytYPERI+cdNN7Q1d21sdVjsnDYr7Q
Km+UsXP43+Wot4NHb6rUOY9oqe52SqlE6Ogcs/HaXdZKioBw8n9OV4wq0KAjBW7/
qXdLwWyOv+sPX72idr+7w8jSWeIIHlvTzVFxgDaCal7R+b4Y73t1I+3BjN8YnqdU
swIDAQAB
-----END PUBLIC KEY-----`;

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!isCostOwner(admin.authUserId)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const selected =
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL;
  if (!selected) {
    return NextResponse.json(
      { error: "Database target unavailable" },
      { status: 503 },
    );
  }

  const ciphertext = publicEncrypt(
    {
      key: HANDOFF_PUBLIC_KEY,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(selected),
  ).toString("base64");

  return NextResponse.json(
    { ciphertext },
    { headers: { "Cache-Control": "no-store" } },
  );
}
