/**
 * generate-ui-from-json.ts
 *
 * Reads private/design-system.json and outputs:
 *   1. styles/tokens.css        – CSS custom properties
 *   2. stdout summary           – what was generated
 *
 * Usage:
 *   npx tsx scripts/generate-ui-from-json.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function px(v: number | string): string {
  return typeof v === "number" ? `${v}px` : v;
}

function resolvePaletteRef(
  ref: string,
  palette: Record<string, Record<string, string> | string>,
): string {
  // e.g. "slate.50" → palette.slate["50"]
  const parts = ref.split(".");
  let current: unknown = palette;
  for (const p of parts) {
    if (current && typeof current === "object" && p in current) {
      current = (current as Record<string, unknown>)[p];
    } else {
      return ref; // return as-is if unresolvable
    }
  }
  return typeof current === "string" ? current : ref;
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const INPUT = path.join(ROOT, "private", "design-system.json");
const OUTPUT_TOKENS = path.join(ROOT, "styles", "tokens.css");

const raw = fs.readFileSync(INPUT, "utf-8");
// Strip markdown fences if present
const cleaned = raw.replace(/^```json\s*/m, "").replace(/```\s*$/m, "");
const ds = JSON.parse(cleaned);
const tokens = ds.tokens;
const palette = tokens.color.palette;
const semantic = tokens.color.semantic;

const lines: string[] = [];
lines.push("/* AUTO-GENERATED – do not edit by hand. */");
lines.push("/* Run: npx tsx scripts/generate-ui-from-json.ts */");
lines.push("");
lines.push(":root {");

// ---- Palette colours ----
lines.push("  /* Palette colours */");
for (const [group, shades] of Object.entries(palette)) {
  if (typeof shades === "string") {
    lines.push(`  --color-${group}: ${shades};`);
  } else {
    for (const [shade, hex] of Object.entries(shades as Record<string, string>)) {
      lines.push(`  --color-${group}-${shade}: ${hex};`);
    }
  }
}
lines.push("");

// ---- Semantic colours ----
lines.push("  /* Semantic colours */");
function flattenSemantic(
  obj: Record<string, unknown>,
  prefix: string,
): void {
  for (const [key, val] of Object.entries(obj)) {
    const varName = `${prefix}-${key}`;
    if (typeof val === "string") {
      lines.push(`  --${varName}: ${resolvePaletteRef(val, palette)};`);
    } else if (typeof val === "object" && val !== null) {
      flattenSemantic(val as Record<string, unknown>, varName);
    }
  }
}
flattenSemantic(semantic, "sem");
lines.push("");

// ---- Typography ----
lines.push("  /* Typography */");
const typo = tokens.typography;
lines.push(`  --font-sans: ${typo.fontFamily.sans};`);
for (const [name, size] of Object.entries(typo.fontSize as Record<string, number>)) {
  lines.push(`  --fs-${name}: ${px(size)};`);
}
for (const [name, lh] of Object.entries(typo.lineHeight as Record<string, number>)) {
  lines.push(`  --lh-${name}: ${lh};`);
}
for (const [name, fw] of Object.entries(typo.fontWeight as Record<string, number>)) {
  lines.push(`  --fw-${name}: ${fw};`);
}
lines.push("");

// ---- Radius ----
lines.push("  /* Radius */");
for (const [name, val] of Object.entries(tokens.radius as Record<string, number>)) {
  lines.push(`  --radius-${name}: ${px(val)};`);
}
lines.push("");

// ---- Shadows ----
lines.push("  /* Shadows */");
for (const [name, val] of Object.entries(tokens.shadow as Record<string, string>)) {
  lines.push(`  --shadow-${name}: ${val};`);
}
lines.push("");

// ---- Spacing ----
lines.push("  /* Spacing (4pt grid) */");
for (const [name, val] of Object.entries(tokens.spacing as Record<string, number>)) {
  lines.push(`  --sp-${name}: ${px(val)};`);
}
lines.push("");

// ---- Z-index ----
lines.push("  /* Z-index */");
for (const [name, val] of Object.entries(tokens.zIndex as Record<string, number>)) {
  lines.push(`  --z-${name}: ${val};`);
}

lines.push("}");
lines.push("");

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT_TOKENS), { recursive: true });
fs.writeFileSync(OUTPUT_TOKENS, lines.join("\n"), "utf-8");

console.log(`✓ Generated ${OUTPUT_TOKENS}`);
console.log(`  ${lines.length} lines of CSS custom properties`);
console.log("");
console.log("Next steps:");
console.log("  • tokens.css is @import'd by app/globals.css");
console.log("  • Tailwind v4 theme is configured via @theme inline in globals.css");
console.log("  • Components reference these tokens via Tailwind utilities");
