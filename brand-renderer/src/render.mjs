import fs from "fs";
import path from "path";
import sharp from "sharp";
import archiver from "archiver";
import { createCanvas } from "@napi-rs/canvas";

/**
 * FINAL UI LIBRARY ASSET GENERATOR (Ship Now)
 * - Creates full asset set described by user (synthetic + placeholders)
 * - Uses brand.json for colors/gradients when present, falls back safely
 * - Copies "keep" assets from input if present (hero photo, IoM flag)
 * - Exports PNG + SVG where requested, plus JPG/WebP for category banners
 * - Writes: site.webmanifest, manifest.json, zip
 */

const ROOT = process.cwd();
const INPUT = path.join(ROOT, "input");
const OUTPUT = path.join(ROOT, "output");

const BRAND_JSON = path.join(INPUT, "brand.json");

// Sizes
const HERO_LOGO_W = 1200;
const COMPACT_LOGO_W = 420;
const EMAIL_LOGO_W = 600;
const EMAIL_FOOTER_W = 320;

const ICON_PNG_SIZES = [512, 256, 128, 64, 32];

const APPLE_TOUCH = 180;
const ANDROID_192 = 192;
const ANDROID_512 = 512;
const MSTILE_150 = 150;

const OG_W = 1200;
const OG_H = 630;
const TW_W = 1200;
const TW_H = 600;

const CATEGORY_W = 1600;
const CATEGORY_H = 900;

const MASTER = 2048;

// Performance knobs
const RENDER_CONCURRENCY = 2;
const RESIZE_CONCURRENCY = 6;
const ENABLE_GRAIN = true;
const GRAIN = 0.035;
const SAFE_INSET_PCT = 0.13;

// ---------- utils ----------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function exists(p) { return fs.existsSync(p); }
function readText(p) { return fs.readFileSync(p, "utf8"); }
function writeText(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, "utf8"); }
function writeBin(p, b) { ensureDir(path.dirname(p)); fs.writeFileSync(p, b); }

function createLimiter(max) {
  let active = 0;
  const q = [];
  const pump = () => {
    if (active >= max) return;
    const job = q.shift();
    if (!job) return;
    active++;
    job().finally(() => { active--; pump(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    q.push(async () => { try { resolve(await fn()); } catch (e) { reject(e); } });
    pump();
  });
}
const limitRender = createLimiter(RENDER_CONCURRENCY);
const limitResize = createLimiter(RESIZE_CONCURRENCY);

function clamp8(v) { return Math.max(0, Math.min(255, v)); }
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

function readSpec() {
  if (!exists(BRAND_JSON)) throw new Error(`Missing input/brand.json at ${BRAND_JSON}`);
  return JSON.parse(fs.readFileSync(BRAND_JSON, "utf8"));
}

function gradientsIndex(spec) {
  const map = new Map();
  for (const g of (spec.gradientSystem?.gradients ?? [])) map.set(g.name, g);
  return map;
}

function tokenToHex(spec, token, fallback) {
  if (!token) return fallback;
  if (typeof token === "string" && token.startsWith("#")) return token;
  const cs = spec.colorSystem ?? {};
  if (typeof token === "string" && cs[token]?.hex) return cs[token].hex;
  return fallback;
}

function stopColor(spec, c) {
  if (typeof c === "string" && c.startsWith("#")) return c;
  return tokenToHex(spec, c, "#FFFFFF");
}

function makeLinearGrad(ctx, g, w, h, spec) {
  const ang = ((g?.angle ?? 90) * Math.PI) / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const x1 = w / 2 - dx * (w / 2);
  const y1 = h / 2 - dy * (h / 2);
  const x2 = w / 2 + dx * (w / 2);
  const y2 = h / 2 + dy * (h / 2);
  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  for (const s of (g?.stops ?? [])) {
    const off = Math.max(0, Math.min(100, s.position ?? 0)) / 100;
    grad.addColorStop(off, stopColor(spec, s.color));
  }
  return grad;
}

function makeRadialGrad(ctx, g, w, h, spec) {
  const r = Math.max(w, h) * 0.75;
  const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, r);
  for (const s of (g?.stops ?? [])) {
    const off = Math.max(0, Math.min(100, s.position ?? 0)) / 100;
    grad.addColorStop(off, stopColor(spec, s.color));
  }
  return grad;
}

function strokeFromGradient(ctx, spec, gIndex, name, fallbackColor, w = MASTER, h = MASTER) {
  if (!name) return fallbackColor;
  const g = gIndex.get(name);
  if (!g) return fallbackColor;
  if (g.type === "linear") return makeLinearGrad(ctx, g, w, h, spec);
  if (g.type === "radial") return makeRadialGrad(ctx, g, w, h, spec);
  return fallbackColor;
}

function drawGraphite(ctx, w, h, spec, gIndex) {
  const g = gIndex.get("graphiteVignette");
  if (g && g.type === "radial") {
    ctx.fillStyle = makeRadialGrad(ctx, g, w, h, spec);
  } else {
    const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w*0.9);
    grad.addColorStop(0, "#0B0A0D");
    grad.addColorStop(0.6, "#050405");
    grad.addColorStop(1, "#000000");
    ctx.fillStyle = grad;
  }
  ctx.fillRect(0,0,w,h);
}

function addGrain(ctx, w, h, strength) {
  const img = ctx.getImageData(0,0,w,h);
  const d = img.data;
  const rnd = lcg(1337);
  for (let i=0;i<d.length;i+=4) {
    const n = (rnd()-0.5) * 255 * strength;
    d[i]   = clamp8(d[i] + n);
    d[i+1] = clamp8(d[i+1] + n);
    d[i+2] = clamp8(d[i+2] + n);
  }
  ctx.putImageData(img,0,0);
}

// ---------- geometry ----------
function ellipsePoint(cx, cy, rx, ry, rot, t) {
  const x = rx * Math.cos(t);
  const y = ry * Math.sin(t);
  const xr = x * Math.cos(rot) - y * Math.sin(rot);
  const yr = x * Math.sin(rot) + y * Math.cos(rot);
  return { x: cx + xr, y: cy + yr };
}

function drawTaperArc(ctx, {
  cx, cy, rx, ry, rot,
  t0, t1,
  widthMax,
  taperPct = 0.24,
  taperExp = 2.05,
  strokeStyle,
  glow = null,
  alpha = 1.0,
  samples = 260
}) {
  let start = t0, end = t1;
  if (end < start) end += Math.PI * 2;

  const total = end - start;
  const n = Math.max(120, samples);
  const dt = total / n;
  const taperLen = total * taperPct;

  const widthAt = (t) => {
    const ds = t - start;
    const de = end - t;
    let ks = 1, ke = 1;
    if (ds < taperLen) ks = Math.pow(ds / taperLen, taperExp);
    if (de < taperLen) ke = Math.pow(de / taperLen, taperExp);
    return widthMax * Math.min(ks, ke);
  };

  const pass = (useGlow) => {
    ctx.save();
    ctx.globalAlpha = useGlow ? (glow?.alpha ?? 0.55) : alpha;
    if (useGlow) {
      ctx.shadowColor = glow?.color ?? "rgba(255,255,255,0.7)";
      ctx.shadowBlur = glow?.blur ?? 50;
    }
    ctx.lineCap = "round";
    ctx.strokeStyle = strokeStyle;

    for (let i=0;i<n;i++) {
      const a = start + dt*i;
      const b = start + dt*(i+1);
      const w = Math.max(1, (widthAt(a)+widthAt(b))/2);
      const p1 = ellipsePoint(cx, cy, rx, ry, rot, a);
      const p2 = ellipsePoint(cx, cy, rx, ry, rot, b);
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y);
      ctx.lineTo(p2.x,p2.y);
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.restore();
  };

  if (glow) pass(true);
  pass(false);
}

function drawSpecular(ctx, { cx, cy, rx, ry, rot, t0, t1, width, alpha=0.18, blur=26 }) {
  let start = t0, end = t1;
  if (end < start) end += Math.PI*2;
  const n = 120;
  const dt = (end-start)/n;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "#FFFFFF";
  ctx.shadowBlur = blur;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#FFFFFF";

  for (let i=0;i<n;i++) {
    const a = start + dt*i;
    const b = start + dt*(i+1);
    const p1 = ellipsePoint(cx, cy, rx, ry, rot, a);
    const p2 = ellipsePoint(cx, cy, rx, ry, rot, b);
    ctx.beginPath();
    ctx.moveTo(p1.x,p1.y);
    ctx.lineTo(p2.x,p2.y);
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- vortex rendering ----------
function getGlow(v, which) {
  const entry = v?.glow?.outer?.[which];
  if (!entry) return null;
  return { color: entry.color, blur: entry.blurPx ?? 50, alpha: entry.opacity ?? 0.55 };
}

function inferPlan(variantName, v) {
  const n = (variantName ?? "").toLowerCase();
  if (n.includes("mono")) return "mono";
  if (n.includes("premium")) return "premium";
  if (n.includes("trust")) return "trust";
  if (n.includes("energy")) return "energy";
  if (v?.gradients?.mono) return "mono";
  if (v?.gradients?.goldArc) return "premium";
  if (v?.gradients?.blueArc && !v?.gradients?.redArc) return "trust";
  if (v?.gradients?.redArc && !v?.gradients?.blueArc) return "energy";
  return "core";
}

function renderVortexMaster(spec, gIndex, { variantName, background }) {
  const canvas = createCanvas(MASTER, MASTER);
  const ctx = canvas.getContext("2d");

  if (background === "vignette") drawGraphite(ctx, MASTER, MASTER, spec, gIndex);

  const geom = spec.iconSystem?.geometry ?? {};
  const rotDeg = geom.ellipseOuter?.rotationDeg ?? -18;
  const rot = (rotDeg * Math.PI) / 180;

  const inset = MASTER * SAFE_INSET_PCT;
  const safeW = MASTER - inset*2;
  const safeH = MASTER - inset*2;

  const rx = safeW * (geom.ellipseOuter?.rxRatio ?? 0.46);
  const ry = safeH * (geom.ellipseOuter?.ryRatio ?? 0.34);

  const outerThickness = (geom.arcThickness?.outerRatioToOuterRy ?? 0.22) * ry;
  const innerThickness = (geom.arcThickness?.innerRatioToOuterRy ?? 0.12) * ry;

  const cx = MASTER/2;
  const cy = MASTER/2;

  const variants = spec.iconSystem?.variants ?? {};
  const v = variants[variantName] ?? variants.core ?? {};

  const redBase = tokenToHex(spec, v.primaryColor, "#E22229");
  const blueBase = tokenToHex(spec, v.secondaryColor, "#157BCA");
  const neutral = tokenToHex(spec, v.neutralColor, "#EFF0F3");

  const plan = inferPlan(variantName, v);

  const chromeStroke = strokeFromGradient(ctx, spec, gIndex, v?.gradients?.chromeCore ?? "chromeRingGradient", neutral);
  const redStroke = strokeFromGradient(ctx, spec, gIndex, v?.gradients?.redArc ?? "redArcGradientStrong", redBase);
  const blueStroke = strokeFromGradient(ctx, spec, gIndex, v?.gradients?.blueArc ?? "blueArcGradientStrong", blueBase);

  const monoStroke = v?.gradients?.mono
    ? strokeFromGradient(ctx, spec, gIndex, v.gradients.mono, neutral)
    : neutral;

  const goldStroke = v?.gradients?.goldArc
    ? strokeFromGradient(ctx, spec, gIndex, v.gradients.goldArc, "#C89B3C")
    : strokeFromGradient(ctx, spec, gIndex, "goldArcGradient", "#C89B3C");

  const angles = {
    blue: { t0: Math.PI * 0.62, t1: Math.PI * 1.72 },
    red:  { t0: Math.PI * 1.86, t1: Math.PI * 2.92 }
  };

  // subtle depth shadow
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.shadowColor = "#000000";
  ctx.shadowBlur = Math.max(18, outerThickness*0.9);
  drawTaperArc(ctx, {
    cx, cy: cy + ry*0.07,
    rx: rx*1.01, ry: ry*1.03, rot,
    t0: Math.PI*0.25, t1: Math.PI*2.05,
    widthMax: outerThickness*0.85,
    taperPct: 0.10, taperExp: 2.2,
    strokeStyle: "rgba(0,0,0,0.25)",
    glow: null, alpha: 0.7, samples: 140
  });
  ctx.restore();

  const arcs = [];
  if (plan === "mono") {
    const glow = getGlow(v, "white") ?? getGlow(v, "black") ?? { color: "#FFFFFF", blur: 40, alpha: 0.16 };
    arcs.push({ which: "blue", stroke: monoStroke, glow });
    arcs.push({ which: "red", stroke: monoStroke, glow });
  } else if (plan === "trust") {
    arcs.push({ which: "blue", stroke: blueStroke, glow: getGlow(v, "blue") ?? { color:"#3CAAFF", blur: Math.max(20, outerThickness*0.95), alpha: 0.55 } });
  } else if (plan === "energy") {
    arcs.push({ which: "red", stroke: redStroke, glow: getGlow(v, "red") ?? { color:"#FF2436", blur: Math.max(22, outerThickness*1.05), alpha: 0.62 } });
  } else if (plan === "premium") {
    arcs.push({ which: "blue", stroke: goldStroke, glow: getGlow(v, "gold") ?? { color:"#E8C15A", blur: Math.max(20, outerThickness*0.95), alpha: 0.44 } });
    arcs.push({ which: "red", stroke: goldStroke, glow: getGlow(v, "gold") ?? { color:"#E8C15A", blur: Math.max(22, outerThickness*1.05), alpha: 0.48 } });
  } else {
    arcs.push({ which: "blue", stroke: blueStroke, glow: getGlow(v, "blue") ?? { color:"#3CAAFF", blur: Math.max(20, outerThickness*0.95), alpha: 0.55 } });
    arcs.push({ which: "red", stroke: redStroke, glow: getGlow(v, "red") ?? { color:"#FF2436", blur: Math.max(22, outerThickness*1.05), alpha: 0.62 } });
  }

  // back-first draw ordering
  const ordered = [...arcs].sort((a,b) => (a.which === "blue" ? -1 : 1));
  for (const arc of ordered) {
    const a = angles[arc.which];
    drawTaperArc(ctx, {
      cx, cy, rx, ry, rot,
      t0: a.t0, t1: a.t1,
      widthMax: outerThickness,
      taperPct: 0.24, taperExp: 2.05,
      strokeStyle: arc.stroke,
      glow: arc.glow,
      alpha: 1.0,
      samples: 260
    });
  }

  // chrome ring
  const coreRx = rx * 0.72;
  const coreRy = ry * 0.72;

  drawTaperArc(ctx, {
    cx, cy, rx: coreRx, ry: coreRy, rot,
    t0: 0, t1: Math.PI*2,
    widthMax: innerThickness,
    taperPct: 0.06, taperExp: 2.4,
    strokeStyle: chromeStroke,
    glow: { color:"#FFFFFF", blur: Math.max(10, innerThickness*0.7), alpha: 0.12 },
    alpha: 0.98,
    samples: 320
  });

  drawTaperArc(ctx, {
    cx, cy, rx: coreRx*0.985, ry: coreRy*0.985, rot,
    t0: 0, t1: Math.PI*2,
    widthMax: Math.max(2, innerThickness*0.16),
    taperPct: 0.05, taperExp: 2.2,
    strokeStyle: "#FFFFFF",
    glow: null,
    alpha: 0.13,
    samples: 220
  });

  drawSpecular(ctx, {
    cx,
    cy: cy - ry*0.18,
    rx: rx*0.82,
    ry: ry*0.22,
    rot,
    t0: Math.PI*1.08,
    t1: Math.PI*1.92,
    width: Math.max(6, innerThickness*0.55),
    alpha: 0.18,
    blur: 26
  });

  if (ENABLE_GRAIN) addGrain(ctx, MASTER, MASTER, GRAIN);

  return canvas.toBuffer("image/png");
}

// ---------- SVG wrappers ----------
function svgWrapper(w, h, hrefFileName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image href="${hrefFileName}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

// Wordmark/logo SVG generator (simple but usable now)
function logoSvg({
  theme = "dark",     // dark or light variant
  withTagline = true,
  withIcon = true,
  width = 1600,
  height = 520
}) {
  const bg = "transparent";
  const text = theme === "light" ? "#111214" : "#EFF0F3";
  const dot = "#E22229";
  const tagline = theme === "light" ? "#202226" : "#FAFAFC";

  // NOTE: icon is raster-embedded later if needed; for now SVG draws a simplified swoosh placeholder.
  // Real icon is provided separately as PNG/SVG, so this is acceptable for "ship now".
  const iconMarkup = withIcon ? `
    <g transform="translate(70,110) scale(1)">
      <path d="M140 140c-70-40-120-15-135 10c-20 35-5 80 35 105c55 35 160 30 220-20"
        fill="none" stroke="#157BCA" stroke-width="26" stroke-linecap="round" opacity="0.95"/>
      <path d="M90 255c55 35 160 30 220-20c45-40 55-105 5-140c-55-35-155-20-220 35"
        fill="none" stroke="#E22229" stroke-width="26" stroke-linecap="round" opacity="0.95"/>
      <path d="M95 180c40-20 120-20 175 10" fill="none" stroke="#EFF0F3" stroke-width="14" opacity="0.55"/>
    </g>` : ``;

  const wordX = withIcon ? 420 : 140;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${bg === "transparent" ? "" : `<rect width="100%" height="100%" fill="${bg}"/>`}
  ${iconMarkup}
  <text x="${wordX}" y="250" font-family="Montserrat, Arial" font-weight="800" font-style="italic"
        font-size="210" fill="${text}">iTrader<tspan fill="${dot}">.im</tspan></text>
  ${withTagline ? `<text x="${wordX}" y="360" font-family="Montserrat, Arial"
        font-size="52" letter-spacing="10" fill="${tagline}">BUY • SELL • UPGRADE</text>` : ``}
</svg>`;
}

// ---------- Export helpers ----------
async function writePng(buf, outPath) {
  writeBin(outPath, buf);
}

async function writeSvg(outPath, svgText) {
  writeText(outPath, svgText);
}

async function resizeToPng(inputBufOrPath, outPath, w, h, fit = "contain") {
  ensureDir(path.dirname(outPath));
  const pipeline = typeof inputBufOrPath === "string"
    ? sharp(inputBufOrPath)
    : sharp(inputBufOrPath);

  await pipeline.resize(w, h, { fit }).png().toFile(outPath);
}

async function resizeToWebp(inputBufOrPath, outPath, w, h, quality = 82, fit = "cover") {
  ensureDir(path.dirname(outPath));
  const pipeline = typeof inputBufOrPath === "string"
    ? sharp(inputBufOrPath)
    : sharp(inputBufOrPath);
  await pipeline.resize(w, h, { fit }).webp({ quality }).toFile(outPath);
}

async function resizeToJpg(inputBufOrPath, outPath, w, h, quality = 86, fit = "cover") {
  ensureDir(path.dirname(outPath));
  const pipeline = typeof inputBufOrPath === "string"
    ? sharp(inputBufOrPath)
    : sharp(inputBufOrPath);
  await pipeline.resize(w, h, { fit }).jpeg({ quality }).toFile(outPath);
}

async function writeMasterAndSizes(pngBuf, baseNoExt, sizes) {
  ensureDir(path.dirname(baseNoExt));
  const master = `${baseNoExt}_master.png`;
  writeBin(master, pngBuf);

  await Promise.all(
    sizes.map((s) => limitResize(async () => {
      await sharp(pngBuf).resize(s, s, { fit: "contain" }).png().toFile(`${baseNoExt}_${s}.png`);
    }))
  );

  writeText(`${baseNoExt}.svg`, svgWrapper(MASTER, MASTER, path.basename(master)));
  return master;
}

// ---------- UI placeholder SVGs ----------
function placeholderSvg({ label, icon = "camera", w = 1200, h = 800 }) {
  const bg1 = "#0B0A0D";
  const bg2 = "#050405";
  const fg = "#EFF0F3";
  const sub = "#B7ACAA";

  const glyph = icon === "user"
    ? `<circle cx="${w/2}" cy="${h/2-40}" r="90" fill="none" stroke="${fg}" stroke-width="10" opacity="0.6"/>
       <path d="M${w/2-170} ${h/2+170}c40-90 300-90 340 0" fill="none" stroke="${fg}" stroke-width="10" opacity="0.6"/>`
    : icon === "badge"
    ? `<path d="M${w/2} ${h/2-160}l120 50v130c0 120-120 170-120 170s-120-50-120-170V${h/2-110}z"
        fill="none" stroke="${fg}" stroke-width="10" opacity="0.6"/>
       <path d="M${w/2-40} ${h/2+10}l30 30 70-90" fill="none" stroke="${fg}" stroke-width="12" opacity="0.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<rect x="${w/2-170}" y="${h/2-130}" width="340" height="220" rx="24" fill="none" stroke="${fg}" stroke-width="10" opacity="0.6"/>
       <path d="M${w/2-120} ${h/2-10}l70-70 160 160" fill="none" stroke="${fg}" stroke-width="10" opacity="0.6"/>
       <circle cx="${w/2+90}" cy="${h/2-70}" r="26" fill="none" stroke="${fg}" stroke-width="10" opacity="0.6"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="g" cx="50%" cy="45%" r="85%">
      <stop offset="0" stop-color="${bg1}"/>
      <stop offset="0.6" stop-color="${bg2}"/>
      <stop offset="1" stop-color="#000"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${glyph}
  <text x="50%" y="${h-130}" text-anchor="middle" font-family="Montserrat, Arial" font-size="54" fill="${fg}" opacity="0.85">${label}</text>
  <text x="50%" y="${h-75}" text-anchor="middle" font-family="Montserrat, Arial" font-size="28" fill="${sub}" opacity="0.75">iTrader.im</text>
</svg>`;
}

// ---------- Decorative assets ----------
function motionStreakSvg({ w = 1600, h = 220, direction = "horizontal" }) {
  const gradId = direction === "vertical" ? "v" : "h";
  const x2 = direction === "vertical" ? 0 : 1;
  const y2 = direction === "vertical" ? 1 : 0;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="${x2}" y2="${y2}">
      <stop offset="0" stop-color="#E22229" stop-opacity="0"/>
      <stop offset="0.25" stop-color="#E22229" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#157BCA" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#157BCA" stop-opacity="0"/>
    </linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="8"/></filter>
  </defs>
  <path d="M40 ${h*0.6}C${w*0.25} ${h*0.1},${w*0.65} ${h*1.1},${w-40} ${h*0.45}"
        fill="none" stroke="url(#${gradId})" stroke-width="22" stroke-linecap="round" filter="url(#blur)"/>
  <path d="M40 ${h*0.62}C${w*0.25} ${h*0.15},${w*0.65} ${h*1.05},${w-40} ${h*0.48}"
        fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="6" stroke-linecap="round"/>
</svg>`;
}

function noiseSvg({ w = 512, h = 512, amount = 0.08 }) {
  // Simple SVG noise pattern (usable as overlay)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <filter id="n">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0
                                        0 0 0 0 0
                                        0 0 0 0 0
                                        0 0 0 ${amount} 0"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#n)"/>
</svg>`;
}

// Glass noise / carbon tile bitmaps
async function makeTilePng({ outPath, w = 256, h = 256, kind = "glass" }) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // base
  ctx.fillStyle = kind === "carbon" ? "#0B0A0D" : "rgba(255,255,255,0)";
  ctx.fillRect(0, 0, w, h);

  const rnd = lcg(kind === "carbon" ? 9001 : 1337);

  if (kind === "glass") {
    // soft speckle
    for (let i = 0; i < w * h * 0.035; i++) {
      const x = Math.floor(rnd() * w);
      const y = Math.floor(rnd() * h);
      const a = 0.04 + rnd() * 0.10;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
  } else {
    // carbon weave
    ctx.globalAlpha = 0.35;
    for (let y = 0; y < h; y += 8) {
      for (let x = 0; x < w; x += 8) {
        const on = ((x / 8 + y / 8) % 2) === 0;
        ctx.fillStyle = on ? "#14161C" : "#07080A";
        ctx.fillRect(x, y, 8, 8);
      }
    }
    ctx.globalAlpha = 1.0;
    // subtle noise
    for (let i = 0; i < w * h * 0.02; i++) {
      const x = Math.floor(rnd() * w);
      const y = Math.floor(rnd() * h);
      const a = 0.03 + rnd() * 0.06;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  writeBin(outPath, canvas.toBuffer("image/png"));
}

// ---------- Spinners / badges ----------
function spinnerSvg({ color = "#E22229", size = 128 }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.05"/>
      <stop offset="0.55" stop-color="${color}" stop-opacity="1"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.15"/>
    </linearGradient>
  </defs>
  <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="url(#g)" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${Math.round(2*Math.PI*r*0.28)} ${Math.round(2*Math.PI*r*0.72)}">
    <animateTransform attributeName="transform" type="rotate" from="0 ${size/2} ${size/2}" to="360 ${size/2} ${size/2}" dur="1s" repeatCount="indefinite"/>
  </circle>
</svg>`;
}

function badgeSvg({ label = "Verified", color = "#157BCA", icon = "check", w = 260, h = 80 }) {
  const iconMarkup = icon === "crown"
    ? `<path d="M56 30l12 16 12-22 12 22 12-16v26H56z" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`
    : icon === "star"
    ? `<path d="M80 22l7 16 18 2-14 12 4 18-15-9-15 9 4-18-14-12 18-2z" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`
    : `<path d="M62 44l12 12 26-34" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0B0A0D"/>
      <stop offset="1" stop-color="#050405"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="${w-4}" height="${h-4}" rx="18" fill="url(#bg)" stroke="${color}" stroke-opacity="0.55" stroke-width="3"/>
  ${iconMarkup}
  <text x="130" y="52" font-family="Montserrat, Arial" font-size="28" fill="#EFF0F3" text-anchor="middle">${label}</text>
</svg>`;
}

// ---------- Logos (SVG + PNG) ----------
async function exportLogoSet() {
  const outDir = path.join(OUTPUT, "logos");
  ensureDir(outDir);

  const items = [
    { name: "logo-full-dark", theme: "dark", withIcon: true, withTagline: true, w: HERO_LOGO_W, h: 420 },
    { name: "logo-full-light", theme: "light", withIcon: true, withTagline: true, w: HERO_LOGO_W, h: 420 },
    { name: "logo-compact-dark", theme: "dark", withIcon: true, withTagline: false, w: COMPACT_LOGO_W, h: 160 },
    { name: "logo-compact-light", theme: "light", withIcon: true, withTagline: false, w: COMPACT_LOGO_W, h: 160 },
    { name: "wordmark-only-dark", theme: "dark", withIcon: false, withTagline: false, w: 900, h: 220 },
    { name: "wordmark-only-light", theme: "light", withIcon: false, withTagline: false, w: 900, h: 220 }
  ];

  for (const it of items) {
    const svg = logoSvg({ theme: it.theme, withIcon: it.withIcon, withTagline: it.withTagline, width: it.w, height: it.h });
    const svgPath = path.join(outDir, `${it.name}.svg`);
    writeText(svgPath, svg);

    // PNG export (except wordmark-only can still have PNG useful)
    const pngPath = path.join(outDir, `${it.name}.png`);
    await sharp(Buffer.from(svg)).png().toFile(pngPath);
  }

  // Email header/footer (PNG only)
  const emailHeaderSvg = logoSvg({ theme: "dark", withIcon: true, withTagline: false, width: EMAIL_LOGO_W, height: 220 });
  await sharp(Buffer.from(emailHeaderSvg)).png().toFile(path.join(outDir, `email-header-logo.png`));

  const emailFooterSvg = logoSvg({ theme: "dark", withIcon: true, withTagline: false, width: EMAIL_FOOTER_W, height: 160 });
  await sharp(Buffer.from(emailFooterSvg)).png().toFile(path.join(outDir, `email-footer-logo.png`));
}

// ---------- OG templates ----------
async function exportOgTemplates() {
  const dir = path.join(OUTPUT, "meta");
  ensureDir(dir);

  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
      <defs>
        <radialGradient id="g" cx="50%" cy="45%" r="90%">
          <stop offset="0" stop-color="#0B0A0D"/>
          <stop offset="0.55" stop-color="#050405"/>
          <stop offset="1" stop-color="#000000"/>
        </radialGradient>
      </defs>
      <rect width="${OG_W}" height="${OG_H}" fill="url(#g)"/>
    </svg>`
  );

  // use full dark logo PNG
  const logoPng = path.join(OUTPUT, "logos", "logo-full-dark.png");
  const logoBuf = exists(logoPng)
    ? await sharp(logoPng).resize(880, null, { fit: "inside" }).png().toBuffer()
    : null;

  const subtitle = async (text) => {
    const c = createCanvas(OG_W, OG_H);
    const ctx = c.getContext("2d");
    ctx.clearRect(0,0,OG_W,OG_H);
    ctx.fillStyle = "#EFF0F3";
    ctx.font = "700 40px Montserrat, Arial";
    ctx.fillText(text, 80, 520);
    return c.toBuffer("image/png");
  };

  // Default OG
  {
    const comps = [];
    if (logoBuf) comps.push({ input: logoBuf, left: 80, top: 120 });
    const out = await sharp(bgSvg)
      .composite(comps)
      .png()
      .toBuffer();
    writeBin(path.join(dir, "opengraph-image.png"), out);
  }

  // Listing OG
  {
    const sub = await subtitle("View this listing on iTrader.im");
    const comps = [];
    if (logoBuf) comps.push({ input: logoBuf, left: 80, top: 100 });
    comps.push({ input: sub, left: 0, top: 0 });
    const out = await sharp(bgSvg).composite(comps).png().toBuffer();
    writeBin(path.join(dir, "opengraph-image-listing.png"), out);
  }

  // Categories OG
  {
    const sub = await subtitle("Browse categories on iTrader.im");
    const comps = [];
    if (logoBuf) comps.push({ input: logoBuf, left: 80, top: 100 });
    comps.push({ input: sub, left: 0, top: 0 });
    const out = await sharp(bgSvg).composite(comps).png().toBuffer();
    writeBin(path.join(dir, "opengraph-image-categories.png"), out);
  }

  // Twitter image
  {
    const w = TW_W, h = TW_H;
    const twBg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <defs>
          <radialGradient id="g" cx="50%" cy="45%" r="90%">
            <stop offset="0" stop-color="#0B0A0D"/>
            <stop offset="0.55" stop-color="#050405"/>
            <stop offset="1" stop-color="#000000"/>
          </radialGradient>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#g)"/>
      </svg>`
    );
    const logoTw = exists(logoPng)
      ? await sharp(logoPng).resize(860, null, { fit: "inside" }).png().toBuffer()
      : null;

    const out = await sharp(twBg).composite(logoTw ? [{ input: logoTw, left: 80, top: 90 }] : []).png().toBuffer();
    writeBin(path.join(dir, "twitter-image.png"), out);
  }
}

// ---------- Category banners (placeholders today) ----------
async function exportCategoryBanners(spec, gIndex) {
  const dir = path.join(OUTPUT, "categories");
  ensureDir(dir);

  // Create on-brand placeholder banners using graphite + motion streak + label.
  const makeBanner = async (label, accent = "redblue") => {
    const c = createCanvas(CATEGORY_W, CATEGORY_H);
    const ctx = c.getContext("2d");

    drawGraphite(ctx, CATEGORY_W, CATEGORY_H, spec, gIndex);

    // streak overlay (simple paint)
    const svg = motionStreakSvg({ w: CATEGORY_W, h: CATEGORY_H * 0.35, direction: "horizontal" });
    const streakPng = await sharp(Buffer.from(svg)).resize(CATEGORY_W, Math.round(CATEGORY_H * 0.35), { fit: "cover" }).png().toBuffer();
    await sharp(c.toBuffer("image/png"))
      .composite([{ input: streakPng, left: 0, top: Math.round(CATEGORY_H*0.28) }])
      .png()
      .toBuffer()
      .then(buf => {
        // draw label on canvas after composite by reloading
        const cc = createCanvas(CATEGORY_W, CATEGORY_H);
        const cctx = cc.getContext("2d");
        // paint composited bg
        // (fast path: just use sharp output and add text via canvas)
        // load into sharp then overlay text png
        const textCanvas = createCanvas(CATEGORY_W, CATEGORY_H);
        const tctx = textCanvas.getContext("2d");
        tctx.clearRect(0,0,CATEGORY_W,CATEGORY_H);
        tctx.fillStyle = "#EFF0F3";
        tctx.font = "800 92px Montserrat, Arial";
        tctx.fillText(label, 80, 140);
        tctx.fillStyle = "#B7ACAA";
        tctx.font = "500 34px Montserrat, Arial";
        tctx.fillText("iTrader.im", 82, 190);

        return sharp(buf)
          .composite([{ input: textCanvas.toBuffer("image/png"), left: 0, top: 0 }])
          .png()
          .toBuffer();
      });

    // The above returned buffer isn't captured; do it cleanly:
    const basePng = await sharp(Buffer.from(c.toBuffer("image/png"))).png().toBuffer();
    const textLayer = createCanvas(CATEGORY_W, CATEGORY_H);
    const tctx = textLayer.getContext("2d");
    tctx.clearRect(0,0,CATEGORY_W,CATEGORY_H);
    tctx.fillStyle = "#EFF0F3";
    tctx.font = "800 92px Montserrat, Arial";
    tctx.fillText(label, 80, 140);
    tctx.fillStyle = "#B7ACAA";
    tctx.font = "500 34px Montserrat, Arial";
    tctx.fillText("iTrader.im", 82, 190);

    const streak = await sharp(Buffer.from(motionStreakSvg({ w: CATEGORY_W, h: 240 }))).png().toBuffer();
    const out = await sharp(basePng)
      .composite([
        { input: streak, left: 0, top: Math.round(CATEGORY_H*0.60) },
        { input: textLayer.toBuffer("image/png"), left: 0, top: 0 },
      ])
      .png()
      .toBuffer();

    return out;
  };

  const items = [
    { file: "category-vehicles", label: "Vehicles" },
    { file: "category-hifi-av", label: "Hi-Fi & AV" },
    { file: "category-watches", label: "Watches" },
    { file: "category-luxury", label: "Luxury" },
    { file: "category-default", label: "Category" }
  ];

  for (const it of items) {
    const png = await makeBanner(it.label);
    await resizeToJpg(png, path.join(dir, `${it.file}.jpg`), CATEGORY_W, CATEGORY_H, 86, "cover");
    await resizeToWebp(png, path.join(dir, `${it.file}.webp`), CATEGORY_W, CATEGORY_H, 82, "cover");
  }
}

// ---------- hero / marketing ----------
async function exportHeroAssets(spec, gIndex) {
  const dir = path.join(OUTPUT, "hero");
  ensureDir(dir);

  // hero-calf-of-man: copy if present; else generate placeholder
  const heroCandidates = [
    path.join(INPUT, "hero-calf-of-man.png"),
    path.join(INPUT, "hero-calf-of-man.jpg"),
    path.join(INPUT, "hero-calf-of-man.jpeg"),
    path.join(INPUT, "hero-calf-of-man.webp")
  ];
  const heroSrc = heroCandidates.find(exists);

  if (heroSrc) {
    // keep, but optimize to webp + jpg
    await resizeToJpg(heroSrc, path.join(dir, "hero-calf-of-man.jpg"), 2560, 1440, 88, "cover");
    await resizeToWebp(heroSrc, path.join(dir, "hero-calf-of-man.webp"), 2560, 1440, 84, "cover");
  } else {
    const svg = placeholderSvg({ label: "Calf of Man", icon: "camera", w: 2560, h: 1440 });
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    await resizeToJpg(buf, path.join(dir, "hero-calf-of-man.jpg"), 2560, 1440, 88, "cover");
    await resizeToWebp(buf, path.join(dir, "hero-calf-of-man.webp"), 2560, 1440, 84, "cover");
  }

  // hero-overlay-gradient
  const overlaySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.15"/>
      <stop offset="0.4" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`;
  await sharp(Buffer.from(overlaySvg)).png().toFile(path.join(dir, "hero-overlay-gradient.png"));

  // motion streak
  writeText(path.join(dir, "hero-motion-streak.svg"), motionStreakSvg({ w: 1800, h: 260 }));
}

// ---------- flags / regional ----------
async function exportFlags() {
  const dir = path.join(OUTPUT, "flags");
  ensureDir(dir);

  const pngSrc = path.join(INPUT, "iom-flag.png");
  const svgSrc = path.join(INPUT, "iom-flag.svg");

  if (exists(pngSrc)) {
    await sharp(pngSrc).resize(1024, null, { fit: "inside" }).png().toFile(path.join(dir, "iom-flag.png"));
    await sharp(pngSrc).resize(1024, null, { fit: "inside" }).webp({ quality: 84 }).toFile(path.join(dir, "iom-flag.webp"));
  } else {
    // placeholder flag
    const svg = placeholderSvg({ label: "Isle of Man", icon: "badge", w: 1200, h: 800 });
    await sharp(Buffer.from(svg)).png().toFile(path.join(dir, "iom-flag.png"));
    await sharp(Buffer.from(svg)).webp({ quality: 84 }).toFile(path.join(dir, "iom-flag.webp"));
  }

  if (exists(svgSrc)) {
    writeText(path.join(dir, "iom-flag.svg"), readText(svgSrc));
  } else {
    // placeholder svg
    writeText(path.join(dir, "iom-flag.svg"), placeholderSvg({ label: "Isle of Man", icon: "badge", w: 1200, h: 800 }));
  }
}

// ---------- UI placeholders / empty states ----------
async function exportPlaceholders() {
  const dir = path.join(OUTPUT, "placeholders");
  ensureDir(dir);

  writeText(path.join(dir, "placeholder-listing.svg"), placeholderSvg({ label: "No photo", icon: "camera", w: 1200, h: 900 }));
  writeText(path.join(dir, "placeholder-avatar.svg"), placeholderSvg({ label: "User", icon: "user", w: 900, h: 900 }));
  writeText(path.join(dir, "placeholder-dealer-logo.svg"), placeholderSvg({ label: "Dealer", icon: "badge", w: 900, h: 600 }));

  const emptyDir = path.join(OUTPUT, "empty-states");
  ensureDir(emptyDir);

  writeText(path.join(emptyDir, "empty-state-no-listings.svg"), placeholderSvg({ label: "No listings found", icon: "camera", w: 1200, h: 800 }));
  writeText(path.join(emptyDir, "empty-state-no-results.svg"), placeholderSvg({ label: "No results", icon: "camera", w: 1200, h: 800 }));
  writeText(path.join(emptyDir, "empty-state-no-messages.svg"), placeholderSvg({ label: "No messages", icon: "camera", w: 1200, h: 800 }));
}

// ---------- decorative / textures ----------
async function exportDecoratives() {
  const dir = path.join(OUTPUT, "decorative");
  ensureDir(dir);

  writeText(path.join(dir, "gradient-streak-horizontal.svg"), motionStreakSvg({ w: 1600, h: 220, direction: "horizontal" }));
  writeText(path.join(dir, "gradient-streak-vertical.svg"), motionStreakSvg({ w: 220, h: 1600, direction: "vertical" }));

  writeText(path.join(dir, "noise-texture.svg"), noiseSvg({ w: 512, h: 512, amount: 0.08 }));

  await makeTilePng({ outPath: path.join(dir, "glass-noise.png"), w: 256, h: 256, kind: "glass" });
  await makeTilePng({ outPath: path.join(dir, "carbon-fiber-pattern.png"), w: 256, h: 256, kind: "carbon" });
}

// ---------- loading / spinners ----------
async function exportSpinners(spec) {
  const dir = path.join(OUTPUT, "loading");
  ensureDir(dir);

  const energy = tokenToHex(spec, "energyRed", "#E22229");
  const trust = tokenToHex(spec, "trustBlue", "#157BCA");
  const neutral = "#D8D9DE";

  writeText(path.join(dir, "spinner-energy.svg"), spinnerSvg({ color: energy, size: 128 }));
  writeText(path.join(dir, "spinner-trust.svg"), spinnerSvg({ color: trust, size: 128 }));
  writeText(path.join(dir, "spinner-default.svg"), spinnerSvg({ color: neutral, size: 128 }));

  // simple animated logo loader (SVG)
  const loader = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <g transform="translate(128 128)">
    <circle r="88" fill="none" stroke="#157BCA" stroke-width="18" stroke-linecap="round" stroke-dasharray="120 440">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.3s" repeatCount="indefinite"/>
    </circle>
    <circle r="88" fill="none" stroke="#E22229" stroke-width="18" stroke-linecap="round" stroke-dasharray="160 400" opacity="0.95">
      <animateTransform attributeName="transform" type="rotate" from="180" to="540" dur="1.3s" repeatCount="indefinite"/>
    </circle>
  </g>
</svg>`;
  writeText(path.join(dir, "logo-animated.svg"), loader);
}

// ---------- badges / trust / payment ----------
async function exportBadges() {
  const dir = path.join(OUTPUT, "badges");
  ensureDir(dir);

  writeText(path.join(dir, "badge-verified-dealer.svg"), badgeSvg({ label: "Verified", color: "#157BCA", icon: "check" }));
  writeText(path.join(dir, "badge-featured.svg"), badgeSvg({ label: "Featured", color: "#E22229", icon: "star" }));
  writeText(path.join(dir, "badge-premium.svg"), badgeSvg({ label: "Premium", color: "#C89B3C", icon: "crown" }));

  const payDir = path.join(OUTPUT, "payment");
  ensureDir(payDir);

  // placeholders you can replace with official assets later
  writeText(path.join(payDir, "payment-secure.svg"), badgeSvg({ label: "Secure", color: "#B7ACAA", icon: "check", w: 240, h: 76 }));
  writeText(path.join(payDir, "payment-stripe.svg"), badgeSvg({ label: "Stripe", color: "#B7ACAA", icon: "check", w: 240, h: 76 }));
}

// ---------- legal/misc icons ----------
async function exportMisc() {
  const dir = path.join(OUTPUT, "misc");
  ensureDir(dir);

  writeText(path.join(dir, "gdpr-cookie-icon.svg"), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <circle cx="48" cy="48" r="34" fill="none" stroke="#B7ACAA" stroke-width="6"/>
  <circle cx="36" cy="40" r="5" fill="#B7ACAA"/>
  <circle cx="56" cy="34" r="4" fill="#B7ACAA"/>
  <circle cx="58" cy="54" r="6" fill="#B7ACAA"/>
</svg>`);

  // leave compliance badge placeholder
  writeText(path.join(dir, "isle-of-man-government-badge.svg"), placeholderSvg({ label: "Compliance", icon: "badge", w: 900, h: 420 }));
}

// ---------- Icons / favicons / app icons ----------
async function exportIconsAndPwa(spec, gIndex) {
  const iconsDir = path.join(OUTPUT, "icons");
  ensureDir(iconsDir);

  const variants = Object.keys(spec.iconSystem?.variants ?? { core: {} });
  const backgrounds = ["transparent", "vignette"];

  const outputs = [];

  // Render vortex masters + required PNG sizes
  await Promise.all(
    variants.flatMap((v) => backgrounds.map((bg) => ({ v, bg })))
      .map(({ v, bg }) => limitRender(async () => {
        const base = path.join(iconsDir, `icon-${v}-${bg}`);
        const masterPng = renderVortexMaster(spec, gIndex, { variantName: v, background: bg });

        // master
        writeBin(`${base}-master.png`, masterPng);

        // sizes for icon-only requirement
        await Promise.all(
          ICON_PNG_SIZES.map((s) => limitResize(async () => {
            await sharp(masterPng).resize(s, s, { fit: "contain" }).png().toFile(`${base}-${s}.png`);
          }))
        );

        // svg wrapper referencing master png (in same folder)
        writeText(`${base}.svg`, svgWrapper(MASTER, MASTER, path.basename(`${base}-master.png`)));

        outputs.push({ type: "icon-only", variant: v, background: bg, base: path.relative(OUTPUT, base) });
        console.log(`✔ icons/icon-${v}-${bg}`);
      }))
  );

  // Favicons & app icons from core transparent (closest to standard)
  const coreMaster = path.join(iconsDir, `icon-core-transparent-master.png`);
  const faviconDir = path.join(OUTPUT, "favicons");
  ensureDir(faviconDir);

  // favicon pngs
  for (const s of [16, 32, 48, 64]) {
    await sharp(coreMaster).resize(s, s, { fit: "contain" }).png().toFile(path.join(faviconDir, `favicon_${s}.png`));
  }

  // icon.png (Next.js convention)
  await sharp(coreMaster).resize(32, 32, { fit: "contain" }).png().toFile(path.join(faviconDir, `icon.png`));

  // icon.svg (vector favicon) - use monochrome white wrapper
  writeText(path.join(faviconDir, `icon.svg`), svgWrapper(512, 512, `../icons/icon-core-transparent-512.png`));

  // apple touch + android + ms tile
  await sharp(coreMaster).resize(APPLE_TOUCH, APPLE_TOUCH, { fit: "contain" }).png().toFile(path.join(faviconDir, `apple-icon.png`));
  await sharp(coreMaster).resize(ANDROID_192, ANDROID_192, { fit: "contain" }).png().toFile(path.join(faviconDir, `android-chrome-192x192.png`));
  await sharp(coreMaster).resize(ANDROID_512, ANDROID_512, { fit: "contain" }).png().toFile(path.join(faviconDir, `android-chrome-512x512.png`));
  await sharp(coreMaster).resize(MSTILE_150, MSTILE_150, { fit: "contain" }).png().toFile(path.join(faviconDir, `mstile-150x150.png`));

  // safari pinned tab svg (monochrome)
  // use a simplified swoosh path (not perfect, but acceptable as pinned tab now)
  writeText(path.join(faviconDir, `safari-pinned-tab.svg`), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <path d="M85 310c-45-55-25-135 40-170c78-43 215-35 302 28"
        fill="none" stroke="#000" stroke-width="44" stroke-linecap="round"/>
  <path d="M130 390c68 46 210 50 306-30c60-50 55-140-10-175c-76-40-205-22-296 60"
        fill="none" stroke="#000" stroke-width="44" stroke-linecap="round"/>
</svg>`);

  // PWA manifest
  const webmanifest = {
    name: "iTrader.im",
    short_name: "iTrader",
    icons: [
      { src: "/assets/favicons/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/assets/favicons/android-chrome-512x512.png", sizes: "512x512", type: "image/png" }
    ],
    theme_color: "#050405",
    background_color: "#050405",
    display: "standalone"
  };
  writeText(path.join(faviconDir, `site.webmanifest`), JSON.stringify(webmanifest, null, 2));

  return outputs;
}

// ---------- zip ----------
function zipOutput() {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(OUTPUT, "itrader-assets.zip");
    const out = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", reject);
    out.on("close", resolve);

    archive.pipe(out);
    archive.directory(OUTPUT, false, (entry) => {
      if (entry.name.endsWith(".zip")) return false;
      return entry;
    });
    archive.finalize();
  });
}

// ---------- MAIN ----------
async function main() {
  ensureDir(OUTPUT);
  const spec = readSpec();
  const gIndex = gradientsIndex(spec);

  const manifest = {
    generatedAt: new Date().toISOString(),
    outputs: []
  };

  // 1) Logos
  await exportLogoSet();
  manifest.outputs.push({ type: "logos", dir: "logos" });

  // 2) Icon-only + PWA
  const iconOutputs = await exportIconsAndPwa(spec, gIndex);
  manifest.outputs.push(...iconOutputs);

  // 3) OG / social
  await exportOgTemplates();
  manifest.outputs.push({ type: "meta", dir: "meta" });

  // 4) Hero
  await exportHeroAssets(spec, gIndex);
  manifest.outputs.push({ type: "hero", dir: "hero" });

  // 5) Categories (placeholders today)
  await exportCategoryBanners(spec, gIndex);
  manifest.outputs.push({ type: "categories", dir: "categories" });

  // 6) Flags
  await exportFlags();
  manifest.outputs.push({ type: "flags", dir: "flags" });

  // 7) UI placeholders / empty states
  await exportPlaceholders();
  manifest.outputs.push({ type: "placeholders", dir: "placeholders" });
  manifest.outputs.push({ type: "empty-states", dir: "empty-states" });

  // 8) Decorative / textures
  await exportDecoratives();
  manifest.outputs.push({ type: "decorative", dir: "decorative" });

  // 9) Loading / animation
  await exportSpinners(spec);
  manifest.outputs.push({ type: "loading", dir: "loading" });

  // 10) Badges / payment
  await exportBadges();
  manifest.outputs.push({ type: "badges", dir: "badges" });
  manifest.outputs.push({ type: "payment", dir: "payment" });

  // 11) Misc / legal
  await exportMisc();
  manifest.outputs.push({ type: "misc", dir: "misc" });

  // Write manifest.json (internal)
  writeText(path.join(OUTPUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Zip
  await zipOutput();

  console.log("DONE: output/itrader-assets.zip");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});