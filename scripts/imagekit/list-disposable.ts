import { getImageKitFileDetails } from "@/lib/media/imagekit-api";
import { deleteDisposableImageKitFile } from "@/lib/media/disposable-media";
import { readDevManifest } from "@/lib/media/dev-manifest";

async function main() {
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY ?? "";
const response = await fetch("https://api.imagekit.io/v1/files?path=/iommarket-dev-disposable&limit=100", {
  headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}` },
});
const payload = await response.json() as Array<{ fileId?: string; filePath?: string; isPrivateFile?: boolean; type?: string }>;
if (!response.ok || !Array.isArray(payload)) {
  console.log(JSON.stringify({ status: response.status, listed: false }));
  process.exit(1);
}
console.log(JSON.stringify({
  status: response.status,
  entries: payload.map((file) => ({ type: file.type ?? "file", path: file.filePath, private: file.isPrivateFile === true })),
}, null, 2));
const files = payload.filter((item) => item.type !== "folder" && item.fileId && item.filePath);
const manifest = new Set(readDevManifest().map((entry) => entry.fileId));
for (const file of files) {
  if (!file.fileId || !file.filePath?.startsWith("/iommarket-dev-disposable/tests/")) continue;
  if (manifest.has(file.fileId)) continue;
  const details = await getImageKitFileDetails({ fileId: file.fileId });
  if (!details) continue;
  await deleteDisposableImageKitFile({
    fileId: details.fileId,
    allowlist: [{ fileId: details.fileId, filePath: details.filePath }],
  });
  console.log(`deleted leftover ${details.filePath}`);
}
}
main();
