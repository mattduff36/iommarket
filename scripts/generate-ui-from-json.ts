/**
 * generate-ui-from-json.ts
 *
 * Reads design-system/design-system-2.json (v2) and outputs:
 *   1. styles/tokens.css  – CSS custom properties (dark-first + light fallback)
 *   2. stdout summary     – what was generated
 *
 * Usage:
 *   npx tsx scripts/generate-ui-from-json.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const INPUT_V2 = path.join(ROOT, "design-system", "design-system-2.json");
const INPUT_V1 = path.join(ROOT, "private", "design-system.json");
const OUTPUT_TOKENS = path.join(ROOT, "styles", "tokens.css");

function px(v: number | string): string {
  return typeof v === "number" ? `${v}px` : String(v);
}

function resolveTokenRef(ref: string, root: Record<string, unknown>): string {
  if (!ref.startsWith("tokens.")) return ref;
  const parts = ref.replace(/^tokens\./, "").split(".");
  let current: unknown = root;
  for (const p of parts) {
    if (current && typeof current === "object" && p in current) {
      current = (current as Record<string, unknown>)[p];
    } else {
      return ref;
    }
  }
  return typeof current === "string" ? current : ref;
}

function resolveAllRefs(value: string, tokens: Record<string, unknown>, depth = 0): string {
  if (depth > 5) return value;
  const resolved = value.replace(/tokens\.[a-zA-Z0-9_.]+/g, (match) =>
    resolveTokenRef(match, tokens),
  );
  if (resolved !== value && /tokens\.[a-zA-Z0-9_.]+/.test(resolved)) {
    return resolveAllRefs(resolved, tokens, depth + 1);
  }
  return resolved;
}

function resolvePaletteRefV1(
  ref: string,
  palette: Record<string, Record<string, string> | string>,
): string {
  const parts = ref.split(".");
  let current: unknown = palette;
  for (const p of parts) {
    if (current && typeof current === "object" && p in current) {
      current = (current as Record<string, unknown>)[p];
    } else {
      return ref;
    }
  }
  return typeof current === "string" ? current : ref;
}

function indent(n: number): string {
  return " ".repeat(n);
}

const rawV2 = fs.readFileSync(INPUT_V2, "utf-8");
const ds2 = JSON.parse(rawV2);
const t = ds2.tokens;

const lines: string[] = [];
lines.push("/* AUTO-GENERATED from design-system-2.json – do not edit by hand. */");
lines.push("/* Run: npx tsx scripts/generate-ui-from-json.ts */");
lines.push("");

/* ------------------------------------------------------------------ */
/*  Dark theme (default + [data-theme="dark"])                        */
/* ------------------------------------------------------------------ */

lines.push(':root, [data-theme="dark"] {');

lines.push(`${indent(2)}/* Palette */`);
const palette = t.color.palette;
for (const [group, shades] of Object.entries(palette)) {
  if (typeof shades === "string") {
    lines.push(`${indent(2)}--color-${group}: ${shades};`);
  } else {
    for (const [shade, hex] of Object.entries(shades as Record<string, string>)) {
      lines.push(`${indent(2)}--color-${group}-${shade}: ${hex};`);
    }
  }
}
lines.push("");

lines.push(`${indent(2)}/* Semantic backgrounds */`);
const sem = t.color.semantic;
lines.push(`${indent(2)}--sem-bg-canvas: ${resolveAllRefs(sem.bg.canvas, t)};`);
lines.push(`${indent(2)}--sem-bg-surface: ${resolveAllRefs(sem.bg.surface, t)};`);
lines.push(`${indent(2)}--sem-bg-surfaceElevated: ${resolveAllRefs(sem.bg.surfaceElevated, t)};`);
lines.push(`${indent(2)}--sem-bg-glass: ${sem.bg.glass};`);
lines.push("");

lines.push(`${indent(2)}/* Semantic text */`);
for (const [key, val] of Object.entries(sem.text as Record<string, string>)) {
  lines.push(`${indent(2)}--sem-text-${key}: ${resolveAllRefs(val, t)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Semantic borders */`);
for (const [key, val] of Object.entries(sem.border as Record<string, string>)) {
  lines.push(`${indent(2)}--sem-border-${key}: ${resolveAllRefs(val, t)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Effects – glows */`);
const effects = t.effects;
for (const [key, val] of Object.entries(effects.glow as Record<string, string>)) {
  lines.push(`${indent(2)}--glow-${key}: ${resolveAllRefs(val, t)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Effects – neon borders */`);
for (const [key, val] of Object.entries(effects.neonBorder as Record<string, string>)) {
  lines.push(`${indent(2)}--neon-border-${key}: ${resolveAllRefs(val, t)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Effects – glass surface */`);
const glass = effects.glassSurface;
lines.push(`${indent(2)}--glass-bg: ${resolveAllRefs(glass.background, t)};`);
lines.push(`${indent(2)}--glass-backdrop: ${glass.backdropFilter};`);
lines.push(`${indent(2)}--glass-border: ${glass.border};`);
lines.push("");

lines.push(`${indent(2)}/* Effects – metallic surface */`);
const metal = effects.metallicSurface;
lines.push(`${indent(2)}--metal-bg: ${metal.background};`);
lines.push(`${indent(2)}--metal-border: ${metal.border};`);
lines.push("");

lines.push(`${indent(2)}/* Effects – misc */`);
lines.push(`${indent(2)}--motion-blur: ${effects.motionBlur};`);
lines.push(`${indent(2)}--gradient-streak: ${effects.gradientStreak};`);
lines.push("");

lines.push(`${indent(2)}/* Typography */`);
const typo = t.typography;
lines.push(`${indent(2)}--font-heading: ${typo.fontFamily.heading};`);
lines.push(`${indent(2)}--font-body: ${typo.fontFamily.body};`);
for (const [name, val] of Object.entries(typo.letterSpacing as Record<string, string>)) {
  lines.push(`${indent(2)}--ls-${name}: ${val};`);
}
lines.push("");

lines.push(`${indent(2)}/* Radius */`);
for (const [name, val] of Object.entries(t.radius as Record<string, string | number>)) {
  lines.push(`${indent(2)}--radius-${name}: ${px(val)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Shadows */`);
for (const [name, val] of Object.entries(t.shadow as Record<string, string>)) {
  lines.push(`${indent(2)}--shadow-${name}: ${resolveAllRefs(val, t)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Spacing (4pt grid) */`);
for (const [name, val] of Object.entries(t.spacing as Record<string, number>)) {
  lines.push(`${indent(2)}--sp-${name}: ${px(val)};`);
}
lines.push("");

lines.push(`${indent(2)}/* Z-index */`);
for (const [name, val] of Object.entries(t.zIndex as Record<string, number>)) {
  lines.push(`${indent(2)}--z-${name}: ${val};`);
}
lines.push("");

lines.push(`${indent(2)}/* Motion */`);
const motion = t.motion;
lines.push(`${indent(2)}--motion-fast: ${motion.fast};`);
lines.push(`${indent(2)}--motion-premium: ${motion.premium};`);
lines.push(`${indent(2)}--motion-hover-lift: ${motion.hoverLift};`);
lines.push(`${indent(2)}--motion-glow-pulse: ${motion.glowPulse};`);
lines.push(`${indent(2)}--motion-slide-streak: ${motion.slideStreak};`);

lines.push("}");
lines.push("");

/* ------------------------------------------------------------------ */
/*  Light theme (fallback from v1 palette)                            */
/* ------------------------------------------------------------------ */

lines.push('[data-theme="light"] {');

let hasV1 = false;
try {
  if (fs.existsSync(INPUT_V1)) {
    const rawV1 = fs.readFileSync(INPUT_V1, "utf-8");
    const cleanedV1 = rawV1.replace(/^```json\s*/m, "").replace(/```\s*$/m, "");
    const ds1 = JSON.parse(cleanedV1);
    const t1 = ds1.tokens;
    const p1 = t1.color.palette;
    const s1 = t1.color.semantic;
    hasV1 = true;

    lines.push(`${indent(2)}/* Light palette (from v1 design-system.json) */`);
    for (const [group, shades] of Object.entries(p1)) {
      if (typeof shades === "string") {
        lines.push(`${indent(2)}--color-${group}: ${shades};`);
      } else {
        for (const [shade, hex] of Object.entries(shades as Record<string, string>)) {
          lines.push(`${indent(2)}--color-${group}-${shade}: ${hex};`);
        }
      }
    }
    lines.push("");

    lines.push(`${indent(2)}/* Light semantic backgrounds */`);
    function flattenSemanticV1(
      obj: Record<string, unknown>,
      prefix: string,
    ): void {
      for (const [key, val] of Object.entries(obj)) {
        const varName = `${prefix}-${key}`;
        if (typeof val === "string") {
          lines.push(`${indent(2)}--${varName}: ${resolvePaletteRefV1(val, p1)};`);
        } else if (typeof val === "object" && val !== null) {
          flattenSemanticV1(val as Record<string, unknown>, varName);
        }
      }
    }
    flattenSemanticV1(s1, "sem");
    lines.push("");

    lines.push(`${indent(2)}/* Light-specific overrides */`);
    lines.push(`${indent(2)}--glow-red: 0 0 12px 2px rgba(220, 38, 38, 0.3);`);
    lines.push(`${indent(2)}--glow-blue: 0 0 12px 2px rgba(59, 130, 246, 0.3);`);
    lines.push(`${indent(2)}--glow-gold: 0 0 12px 2px rgba(180, 83, 9, 0.25);`);
    lines.push(`${indent(2)}--glow-softWhite: 0 0 8px 0 rgba(0, 0, 0, 0.08);`);
    lines.push("");
    lines.push(`${indent(2)}--glass-bg: rgba(255, 255, 255, 0.8);`);
    lines.push(`${indent(2)}--glass-backdrop: blur(12px);`);
    lines.push(`${indent(2)}--glass-border: 1px solid rgba(0, 0, 0, 0.08);`);
    lines.push(`${indent(2)}--metal-bg: linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%);`);
    lines.push(`${indent(2)}--metal-border: 1px solid #D1D5DB;`);
    lines.push("");
    lines.push(`${indent(2)}--shadow-low: 0 1px 3px rgba(0, 0, 0, 0.06);`);
    lines.push(`${indent(2)}--shadow-high: 0 8px 24px rgba(0, 0, 0, 0.1);`);
    lines.push(`${indent(2)}--shadow-neonRed: 0 0 12px 2px rgba(220, 38, 38, 0.25);`);
    lines.push(`${indent(2)}--shadow-neonBlue: 0 0 12px 2px rgba(59, 130, 246, 0.25);`);

    lines.push(`${indent(2)}/* Light typography */`);
    lines.push(`${indent(2)}--font-heading: ${typo.fontFamily.heading};`);
    lines.push(`${indent(2)}--font-body: ${typo.fontFamily.body};`);
  }
} catch {
  /* v1 file not available — light theme will inherit dark vars */
}

if (!hasV1) {
  lines.push(`${indent(2)}/* No v1 file found – light mode inherits dark tokens */`);
  lines.push(`${indent(2)}/* Add a dedicated light palette to design-system-2.json when ready */`);
}

lines.push("}");
lines.push("");

fs.mkdirSync(path.dirname(OUTPUT_TOKENS), { recursive: true });
fs.writeFileSync(OUTPUT_TOKENS, lines.join("\n"), "utf-8");

console.log(`✓ Generated ${OUTPUT_TOKENS}`);
console.log(`  ${lines.length} lines of CSS custom properties`);
console.log(`  Dark theme: design-system-2.json (v2)`);
console.log(`  Light theme: ${hasV1 ? "design-system.json (v1) fallback" : "inherits dark"}`);
