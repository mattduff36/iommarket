$ErrorActionPreference = "Stop"

$RootPath = "D:\Websites\iommarket\brand-renderer"
$SrcPath  = "$RootPath\src"

Write-Host "`n=== Upgrading to Phase 3 (Hybrid Chrome Engine) ===" -ForegroundColor Cyan

if (!(Test-Path $RootPath)) {
  Write-Host "brand-renderer folder not found: $RootPath" -ForegroundColor Red
  exit 1
}

# Ensure dependency exists (won't fail if already installed)
Set-Location $RootPath
pnpm add @napi-rs/canvas | Out-Host

@'
import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "input");
const OUTPUT = path.join(ROOT, "output");

const WEB_SIZES = [256, 512, 1024, 2048];
const APP_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const BACKGROUNDS = ["transparent", "vignette"];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function getGradientByName(spec, name) {
  const grads = spec.gradientSystem?.gradients ?? [];
  return grads.find(g => g.name === name) ?? null;
}

function tokenToHex(spec, token, fallback) {
  if (!token) return fallback;
  if (typeof token === "string" && token.startsWith("#")) return token;

  // try colorSystem token
  const cs = spec.colorSystem ?? {};
  if (typeof token === "string" && cs[token]?.hex) return cs[token].hex;

  return fallback;
}

function applyStopsToCanvasGradient(grad, stops, w, h) {
  // stops: [{color, position}] position 0..100
  for (const s of stops) {
    const off = Math.max(0, Math.min(100, s.position ?? 0)) / 100;
    grad.addColorStop(off, s.color);
  }
  return grad;
}

function makeLinearCanvasGradient(ctx, g, w, h) {
  // Approximate angle-based linear gradient across canvas
  const angle = (g?.angle ?? 90) * (Math.PI / 180);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const x1 = w/2 - dx * (w/2);
  const y1 = h/2 - dy * (h/2);
  const x2 = w/2 + dx * (w/2);
  const y2 = h/2 + dy * (h/2);

  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  return applyStopsToCanvasGradient(grad, g?.stops ?? [], w, h);
}

function drawVignette(ctx, w, h, spec) {
  const v = getGradientByName(spec, "graphiteVignette");
  if (!v || v.type !== "radial") {
    ctx.fillStyle = "#050405";
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w, h) * 0.55);
  for (const s of v.stops ?? []) {
    const off = Math.max(0, Math.min(100, s.position ?? 0)) / 100;
    grad.addColorStop(off, s.color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function addFilmGrain(ctx, w, h, amount = 0.08) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // deterministic-ish grain (fast LCG)
  let seed = 1337;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 255 * amount;
    d[i]   = clamp8(d[i] + n);
    d[i+1] = clamp8(d[i+1] + n);
    d[i+2] = clamp8(d[i+2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

function clamp8(v) { return Math.max(0, Math.min(255, v)); }

function drawGlowStroke(ctx, drawFn, color, blur, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  drawFn();
  ctx.restore();
}

function drawArcRing(ctx, cx, cy, rx, ry, rotRad, startT, endT, strokeWidth, strokeStyle) {
  // Draw ellipse arc by scaling a circle arc:
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotRad);
  ctx.scale(rx, ry);

  ctx.beginPath();
  ctx.arc(0, 0, 1, startT, endT, false);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = strokeWidth / Math.max(rx, ry); // compensate scale
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.restore();
}

function renderVortexCanvas(spec, { size = 2048, variant = "core", background = "transparent" }) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // background
  if (background === "vignette") drawVignette(ctx, size, size, spec);

  const geom = spec.iconSystem?.geometry ?? {};
  const rotDeg = geom.ellipseOuter?.rotationDeg ?? -18;
  const rot = rotDeg * Math.PI / 180;

  const rx = size * (geom.ellipseOuter?.rxRatio ?? 0.46);
  const ry = size * (geom.ellipseOuter?.ryRatio ?? 0.34);
  const cx = size/2;
  const cy = size/2;

  const arcThickOuter = (geom.arcThickness?.outerRatioToOuterRy ?? 0.22) * ry;
  const arcThickInner = (geom.arcThickness?.innerRatioToOuterRy ?? 0.12) * ry;

  const variants = spec.iconSystem?.variants ?? {};
  const v = variants[variant] ?? variants.core ?? {};

  // Colors
  const red = tokenToHex(spec, v.primaryColor, "#E22229");
  const blue = tokenToHex(spec, v.secondaryColor, "#157BCA");
  const silver = tokenToHex(spec, v.neutralColor, "#B7ACAA");

  // Gradients from JSON (fallback to flat)
  const chromeRing = getGradientByName(spec, v.gradients?.chromeCore ?? "chromeRingGradient") ?? getGradientByName(spec, "chromeRingGradient");
  const redArcGrad = getGradientByName(spec, v.gradients?.redArc ?? "redArcGradientStrong") ?? getGradientByName(spec, "redArcGradientStrong");
  const blueArcGrad = getGradientByName(spec, v.gradients?.blueArc ?? "blueArcGradientStrong") ?? getGradientByName(spec, "blueArcGradientStrong");

  const chromeStroke = chromeRing ? makeLinearCanvasGradient(ctx, chromeRing, size, size) : silver;
  const redStroke = redArcGrad ? makeLinearCanvasGradient(ctx, redArcGrad, size, size) : red;
  const blueStroke = blueArcGrad ? makeLinearCanvasGradient(ctx, blueArcGrad, size, size) : blue;

  // Shadow (soft)
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = 28;
  ctx.translate(0, size * 0.02);
  drawArcRing(ctx, cx, cy, rx * 1.02, ry * 1.04, rot, 0.2, Math.PI * 1.9, arcThickOuter, "rgba(0,0,0,0.2)");
  ctx.restore();

  // Arc ranges (picked to feel like the board; we can calibrate)
  const blueStart = Math.PI * 0.65;
  const blueEnd   = Math.PI * 1.75;

  const redStart  = Math.PI * 1.85;
  const redEnd    = Math.PI * 0.95 + Math.PI * 2; // wrap

  // Blue glow + stroke (back)
  drawGlowStroke(ctx, () => {
    drawArcRing(ctx, cx, cy, rx, ry, rot, blueStart, blueEnd, arcThickOuter, blueStroke);
  }, "#3CAAFF", 44, 0.50);

  drawArcRing(ctx, cx, cy, rx, ry, rot, blueStart, blueEnd, arcThickOuter, blueStroke);

  // Chrome core ring
  drawArcRing(ctx, cx, cy, rx * 0.72, ry * 0.72, rot, 0, Math.PI * 2, arcThickInner, chromeStroke);

  // Inner rim highlight (thin, subtle)
  ctx.save();
  ctx.globalAlpha = 0.22;
  drawArcRing(ctx, cx, cy, rx * 0.70, ry * 0.70, rot, 0, Math.PI * 2, arcThickInner * 0.20, "#EFF0F3");
  ctx.restore();

  // Red glow + stroke (front)
  drawGlowStroke(ctx, () => {
    drawArcRing(ctx, cx, cy, rx, ry, rot, redStart, redEnd, arcThickOuter, redStroke);
  }, "#FF2436", 46, 0.55);

  drawArcRing(ctx, cx, cy, rx, ry, rot, redStart, redEnd, arcThickOuter, redStroke);

  // Specular highlight band (top)
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.shadowColor = "#FFFFFF";
  ctx.shadowBlur = 18;
  drawArcRing(ctx, cx, cy - ry * 0.18, rx * 0.78, ry * 0.22, rot, Math.PI * 1.05, Math.PI * 1.95, arcThickInner * 0.55, "#FFFFFF");
  ctx.restore();

  // Light grain for “render feel”
  addFilmGrain(ctx, size, size, 0.06);

  return canvas.toBuffer("image/png");
}

function svgWrapperForPng({ w, h, href }) {
  // SVG wrapper that embeds a raster PNG (keeps your “PNG + SVG” delivery requirement)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

async function writePngAndSizes(pngBuf, basePath, sizes, square = true) {
  // Write master (already at max size), then resize down
  ensureDir(path.dirname(basePath));
  fs.writeFileSync(`${basePath}_master.png`, pngBuf);

  for (const s of sizes) {
    const out = `${basePath}_${s}.png`;
    const pipeline = sharp(pngBuf).resize(s, s, { fit: square ? "contain" : "inside" });
    await pipeline.png().toFile(out);
  }
}

async function zipOutput() {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(OUTPUT, "itrader-assets.zip");
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(OUTPUT, false, (entry) => {
      if (entry.name.endsWith(".zip")) return false;
      return entry;
    });
    archive.finalize();
  });
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function main() {
  ensureDir(OUTPUT);
  const spec = readJSON(path.join(INPUT, "brand.json"));

  const variants = Object.keys(spec.iconSystem?.variants ?? { core: {} });

  // VORTEX ICONS (hybrid chrome)
  for (const v of variants) {
    for (const bg of BACKGROUNDS) {
      const name = `icons/vortex_${v}_${bg}`;
      const base = path.join(OUTPUT, name);

      const masterPng = renderVortexCanvas(spec, { size: 2048, variant: v, background: bg });
      await writePngAndSizes(masterPng, base, WEB_SIZES, true);

      // SVG wrapper referencing the master PNG
      const svg = svgWrapperForPng({ w: 2048, h: 2048, href: `${path.basename(name)}_master.png` })
        .replace(`${path.basename(name)}_master.png`, `./${path.basename(name)}_master.png`);
      // Put wrapper next to images (simple, predictable path)
      fs.writeFileSync(`${base}.svg`, svg, "utf8");

      console.log(`✔ ${name}`);
    }
  }

  // APP ICONS (container + vortex)
  for (const v of variants) {
    for (const bg of BACKGROUNDS) {
      // render vortex at 2048, then place on app icon background in sharp
      const vortex = renderVortexCanvas(spec, { size: 1536, variant: v, background: "transparent" });

      const appBg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#0B0A0D"/>
              <stop offset="0.45" stop-color="#121318"/>
              <stop offset="1" stop-color="#050405"/>
            </linearGradient>
          </defs>
          <rect width="2048" height="2048" rx="450" ry="450" fill="url(#bg)"/>
        </svg>`
      );

      let composed = await sharp(appBg)
        .composite([{ input: vortex, left: Math.round((2048 - 1536) / 2), top: Math.round((2048 - 1536) / 2 - 40) }])
        .png()
        .toBuffer();

      if (bg === "vignette") {
        // vignette behind app icon
        const vignette = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048">
            <radialGradient id="v" cx="50%" cy="50%" r="75%">
              <stop offset="0" stop-color="#050405"/>
              <stop offset="0.55" stop-color="#0B0A0D"/>
              <stop offset="1" stop-color="#000000"/>
            </radialGradient>
            <rect width="2048" height="2048" fill="url(#v)"/>
          </svg>`
        );
        composed = await sharp(vignette).composite([{ input: composed, left: 0, top: 0 }]).png().toBuffer();
      }

      const name = `app-icons/appicon_${v}_${bg}`;
      const base = path.join(OUTPUT, name);

      await writePngAndSizes(composed, base, APP_SIZES, true);

      const svg = svgWrapperForPng({ w: 2048, h: 2048, href: `./${path.basename(name)}_master.png` });
      fs.writeFileSync(`${base}.svg`, svg, "utf8");

      console.log(`✔ ${name}`);
    }
  }

  await zipOutput();
  console.log("PHASE 3 COMPLETE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
'@ | Set-Content "$SrcPath\render.mjs" -Encoding UTF8

Write-Host "✓ Phase 3 engine written to src/render.mjs" -ForegroundColor Green

Write-Host "`n=== Running Renderer ===" -ForegroundColor Cyan
pnpm render | Out-Host

$ZipPath = "$RootPath\output\itrader-assets.zip"
Write-Host "`n=== DONE ===" -ForegroundColor Cyan
if (Test-Path $ZipPath) {
  Write-Host "ZIP created at:" -ForegroundColor Green
  Write-Host $ZipPath
} else {
  Write-Host "ZIP not found. Check the terminal output above." -ForegroundColor Red
}

Read-Host "Press ENTER to exit"