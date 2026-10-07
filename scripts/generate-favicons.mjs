import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("brand-assets/source/itrader-icon-a.png", root));
const png = (size) => sharp(source).flatten({ background: "#000000" }).resize(size, size).png().toBuffer();
const save = (path, data) => writeFile(new URL(path, root), data);

// PNG-compressed ICO frames retain the approved artwork at every browser size.
const sizes = [16, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index] % 256;
  header[entry + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await save("app/favicon.ico", Buffer.concat([header, ...frames]));

for (const [path, size] of [
  ["app/icon.png", 48], ["app/apple-icon.png", 180],
  ["public/apple-touch-icon.png", 180], ["public/apple-touch-icon-precomposed.png", 180],
  ["public/favicon-16x16.png", 16], ["public/favicon-32x32.png", 32],
  ["public/icon-192.png", 192], ["public/icon-512.png", 512],
  ["public/images/icon-itrader.png", 512], ["public/images/icon-itrader-trans.png", 512],
]) await save(path, await png(size));

// The entire square artwork fits inside the maskable icon's central safe circle.
for (const size of [192, 512]) {
  const inset = await png(Math.floor(size * 0.56));
  const maskable = await sharp({ create: { width: size, height: size, channels: 3, background: "#000000" } })
    .composite([{ input: inset, gravity: "centre" }]).png().toBuffer();
  await save(`public/icon-maskable-${size}.png`, maskable);
}

// Embed the raster master, rather than approximating the approved metallic design with new paths.
const embedded = (await png(512)).toString("base64");
await save("public/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><image width="512" height="512" xlink:href="data:image/png;base64,${embedded}"/></svg>\n`);
process.stdout.write(`Generated version A favicon package in ${fileURLToPath(root)}\n`);
