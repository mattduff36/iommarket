# UI Library Documentation (v2)

## Overview

The itrader.im UI library is a local component system built on:

- **Tailwind CSS v4** (CSS-based theme configuration)
- **Radix UI** primitives for accessible, unstyled components
- **class-variance-authority (cva)** for variant management
- **@once-ui-system/core** ThemeProvider for dark/light mode switching
- **design-system-2.json** as the versioned source of truth

Design tokens are sourced from `design-system/design-system-2.json` and compiled into CSS custom properties + Tailwind theme values.

---

## Architecture

```
├── design-system/design-system-2.json  ← source of truth (v2, committed)
├── scripts/generate-ui-from-json.ts    ← token generator
├── styles/tokens.css                   ← generated CSS custom properties
├── app/globals.css                     ← Tailwind v4 @theme + base styles
├── tailwind.config.ts                  ← reference config (docs/tooling)
├── lib/cn.ts                           ← clsx + tailwind-merge utility
├── components/
│   ├── ui/                             ← primitives (@/components/ui/*)
│   ├── ui/index.ts                     ← barrel export
│   └── marketplace/                    ← domain components
└── app/uidemo/page.tsx                 ← live component showcase
```

---

## Tokens

### Generating tokens

```bash
npm run tokens:generate
# or: npx tsx scripts/generate-ui-from-json.ts
```

This reads `design-system/design-system-2.json` (v2) and outputs `styles/tokens.css` with CSS custom properties scoped to `data-theme="dark"` (default) and `data-theme="light"` (fallback from v1).

### Token categories

| Category   | CSS prefix      | Example                              | Tailwind utility          |
|------------|-----------------|--------------------------------------|---------------------------|
| Palette    | `--color-*`     | `--color-graphite-900: #0A0A0B`      | `bg-graphite-900`         |
| Semantic   | `--sem-*`       | `--sem-text-primary: #FFFFFF`        | `text-text-primary`       |
| Effects    | `--glow-*`      | `--glow-red: 0 0 15px 2px ...`      | `shadow-glow-red`         |
| Glass      | `--glass-*`     | `--glass-bg: rgba(20,20,22,0.7)`    | `.glass-surface` helper   |
| Metal      | `--metal-*`     | `--metal-bg: linear-gradient(...)`   | `.metal-surface` helper   |
| Typography | `--font-*`      | `--font-heading: 'Orbitron', ...`    | `font-heading`            |
| Radius     | `--radius-*`    | `--radius-md: 4px`                   | `rounded-md`              |
| Shadow     | `--shadow-*`    | `--shadow-neonRed: ...`              | `shadow-neon-red`         |
| Spacing    | `--sp-*`        | `--sp-4: 16px`                       | `p-4`, `gap-4`            |
| Z-index    | `--z-*`         | `--z-modal: 1400`                    | `z-[1400]`                |
| Motion     | `--motion-*`    | `--motion-fast: 150ms ...`           | `duration-fast`           |

### Key semantic colours (v2)

| Purpose          | Variable                   | Tailwind class            |
|------------------|----------------------------|---------------------------|
| Page background  | `--sem-bg-canvas`          | `bg-canvas`               |
| Card surface     | `--sem-bg-surface`         | `bg-surface`              |
| Elevated surface | `--sem-bg-surfaceElevated` | `bg-surface-elevated`     |
| Glass surface    | `--sem-bg-glass`           | `bg-glass`                |
| Primary text     | `--sem-text-primary`       | `text-text-primary`       |
| Secondary text   | `--sem-text-secondary`     | `text-text-secondary`     |
| Energy accent    | `--sem-text-energy`        | `text-text-energy`        |
| Trust accent     | `--sem-text-trust`         | `text-text-trust`         |
| Premium accent   | `--sem-text-premium`       | `text-text-premium`       |
| Default border   | `--sem-border-default`     | `border-border`           |
| Focus ring       | `--glow-blue`              | `shadow-glow-blue`        |

---

## Components

### Button

Variants: **energy** (red, uppercase italic), **trust** (blue), **premium** (gold gradient, gated), **ghost**, **link**

```tsx
<Button variant="energy" leftIcon={<Zap />}>Buy Now</Button>
<Button variant="trust">Learn More</Button>
<Button variant="premium" leftIcon={<Crown />}>Upgrade</Button>
<Button variant="ghost">Cancel</Button>
```

### Input

Graphite surface, neon-blue focus border + glow, error state with red glow.

```tsx
<Input label="Email" placeholder="you@example.com" error={errors.email} />
```

### Badge

Variants: **energy**, **trust**, **premium**, **neutral**, **success**, **error**, **warning**, **info**, **price**

### ListingCard

Dark card surface, hover lift + metallic border, image overlay gradient, energy-colored price.

### Navbar (SiteHeader)

Glass surface with backdrop blur, neon trust border bottom.

---

## Theme Mode

Dark mode is default. Light mode is supported via `data-theme="light"` (uses v1 palette as fallback).

The Once UI `ThemeProvider` in `app/layout.tsx` manages the `data-theme` attribute.

---

## CSS Helpers

| Class            | Effect                                    |
|------------------|-------------------------------------------|
| `.glass-surface` | Frosted glass background + blur + border  |
| `.metal-surface` | Metallic gradient + border                |
| `.glow-energy`   | Red neon glow box-shadow                  |
| `.glow-trust`    | Blue neon glow box-shadow                 |
| `.glow-premium`  | Gold neon glow box-shadow                 |
| `.gradient-streak`| Decorative streak line                   |

---

## Accessibility

- **Focus rings**: neon-blue `focus-visible` outline on all interactive elements
- **Keyboard navigation**: Enter/Space for buttons, Escape for dialogs, arrow keys for sliders
- **ARIA attributes**: `aria-label`, `aria-invalid`, `aria-describedby`, `aria-disabled`
- **Selection color**: neon-blue highlight

---

## Extending

### Modifying tokens

1. Edit `design-system/design-system-2.json`
2. Run `npm run tokens:generate`
3. Update `@theme inline` block in `app/globals.css` if new tokens were added

### Adding a new component

1. Create `components/ui/my-component.tsx`
2. Use Radix primitives if it needs interactivity
3. Style with Tailwind classes referencing the token-based theme
4. Use `cva()` for variant management
5. Forward refs, use strict TypeScript
6. Add it to `components/ui/index.ts` barrel export
7. Add it to the `/uidemo` showcase page
