# UI Library Documentation

## Overview

The IOM Market UI library is a local component system built on:

- **Tailwind CSS v4** (CSS-based theme configuration)
- **Radix UI** primitives for accessible, unstyled components
- **class-variance-authority (cva)** for variant management
- **shadcn/ui conventions** for API consistency

Design tokens are sourced from `private/design-system.json` and compiled into CSS custom properties + Tailwind theme values.

---

## Architecture

```
├── private/design-system.json     ← source of truth
├── scripts/generate-ui-from-json.ts  ← token generator
├── styles/tokens.css              ← generated CSS custom properties
├── app/globals.css                ← Tailwind v4 @theme + base styles
├── tailwind.config.ts             ← reference config (docs/tooling)
├── lib/cn.ts                      ← clsx + tailwind-merge utility
├── components/
│   ├── ui/                        ← primitives (@/components/ui/*)
│   └── marketplace/               ← domain components (@/components/marketplace/*)
└── app/styleguide/page.tsx        ← live component showcase
```

---

## Tokens

### Generating tokens

```bash
npx tsx scripts/generate-ui-from-json.ts
```

This reads `private/design-system.json` and outputs `styles/tokens.css` with all CSS custom properties.

### Token categories

| Category   | CSS prefix    | Example                         | Tailwind utility         |
|------------|---------------|---------------------------------|--------------------------|
| Palette    | `--color-*`   | `--color-slate-900: #111827`    | `text-slate-900`         |
| Semantic   | `--sem-*`     | `--sem-text-primary: #111827`   | `text-text-primary`      |
| Typography | `--fs-*`      | `--fs-sm: 14px`                 | `text-sm`                |
| Radius     | `--radius-*`  | `--radius-md: 6px`              | `rounded-md`             |
| Shadow     | `--shadow-*`  | `--shadow-md: ...`              | `shadow-md`              |
| Spacing    | `--sp-*`      | `--sp-4: 16px`                  | `p-4`, `gap-4`           |
| Z-index    | `--z-*`       | `--z-modal: 1400`               | `z-[1400]`               |

### Key semantic colours

| Purpose          | Variable                     | Tailwind class           |
|------------------|------------------------------|--------------------------|
| Page background  | `--sem-bg-canvas`            | `bg-canvas`              |
| Card surface     | `--sem-bg-surface`           | `bg-surface`             |
| Primary text     | `--sem-text-primary`         | `text-text-primary`      |
| Secondary text   | `--sem-text-secondary`       | `text-text-secondary`    |
| Default border   | `--sem-border-default`       | `border-border`          |
| Focus ring       | `--shadow-outline`           | `shadow-outline`         |
| Primary action   | `--sem-action-primary-bg`    | `bg-primary`             |
| Destructive      | `--sem-action-destructive-bg`| `bg-destructive`         |

---

## Components

### Import paths

```tsx
// UI primitives
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Marketplace
import { ListingCard } from "@/components/marketplace/listing-card";
import { SearchBar } from "@/components/marketplace/search-bar";
import { FilterPanel } from "@/components/marketplace/filter-panel";
```

### UI Primitives (`@/components/ui/`)

| Component      | Radix primitive | Variants                                        |
|----------------|-----------------|--------------------------------------------------|
| Button         | Slot            | primary, secondary, destructive, ghost, link     |
| Input          | –               | default, error, disabled                         |
| Select         | Select          | –                                                |
| Checkbox       | Checkbox        | checked, unchecked, disabled                     |
| Switch         | Switch          | checked, unchecked, disabled                     |
| Slider         | Slider          | single, range                                    |
| Badge          | –               | success, error, warning, info, neutral           |
| Card           | –               | Header, Title, Description, Content, Footer      |
| Dialog         | Dialog          | open/closed                                      |
| DropdownMenu   | DropdownMenu    | items, checkbox items, sub-menus                 |
| Tabs           | Tabs            | active, inactive                                 |
| Table          | –               | Header, Body, Row, Head, Cell                    |
| Pagination     | –               | page navigation with ellipsis                    |
| Alert          | –               | success, error, info, warning                    |
| Toast          | Toast           | default, success, error                          |
| Skeleton       | –               | rectangle, circle, text                          |
| EmptyState     | –               | icon + title + description + action              |

### Marketplace Components (`@/components/marketplace/`)

| Component    | Description                                      |
|--------------|--------------------------------------------------|
| ListingCard  | Card for marketplace items: image, title, price, location, badges |
| SearchBar    | Search input with icon, clear button, enter-to-search |
| FilterPanel  | Sidebar with category checkboxes, price slider, condition filters |

---

## Usage Patterns

### Class composition with `cn()`

```tsx
import { cn } from "@/lib/cn";

<div className={cn("p-4 rounded-md", isActive && "bg-royal-50")} />
```

### Button with variants

```tsx
<Button variant="primary" size="md">Save</Button>
<Button variant="destructive" loading>Deleting...</Button>
<Button variant="secondary" disabled>Unavailable</Button>
```

### Input with validation

```tsx
<Input
  label="Email"
  placeholder="you@example.com"
  error={errors.email}
  aria-required
/>
```

### ListingCard

```tsx
<ListingCard
  title="Vintage Rolex"
  price={12500}
  location="Douglas, IOM"
  imageSrc="/images/watch.jpg"
  badge="Featured"
  featured
  href="/listings/1"
/>
```

### FilterPanel

```tsx
<FilterPanel
  categories={[{ label: "Cars", value: "cars", count: 42 }]}
  selectedCategories={selected}
  onCategoryChange={setSelected}
  priceRange={range}
  onPriceChange={setRange}
  onReset={handleReset}
/>
```

---

## Accessibility

All components follow the a11y rules defined in `design-system.json`:

- **Focus rings**: `shadow-outline` (3px blue ring) applied on focus-visible
- **Keyboard navigation**: Enter/Space for buttons, Escape for dialogs, arrow keys for sliders/dropdowns
- **ARIA attributes**: `aria-label`, `aria-invalid`, `aria-describedby`, `aria-disabled`, `role` attributes applied where specified
- **Screen readers**: `sr-only` class used for visually hidden labels

---

## Layout Patterns

### Marketplace Grid (from design-system.json)

```
Sidebar (280px fixed) | Main grid (auto-fill, minmax 280px)
```

```tsx
<div className="flex gap-6">
  <FilterPanel className="w-[280px] shrink-0" />
  <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
    {listings.map(item => <ListingCard key={item.id} {...item} />)}
  </div>
</div>
```

### Price Formatting

- Currency symbol precedes value
- No decimals for whole numbers
- Bold font weight

```tsx
// Built into ListingCard. For standalone use:
function formatPrice(price: number, currency = "£"): string {
  return Number.isInteger(price)
    ? `${currency}${price.toLocaleString()}`
    : `${currency}${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}
```

---

## Styleguide

View all components at: [/styleguide](/styleguide)

---

## Extending

### Adding a new component

1. Create `components/ui/my-component.tsx`
2. Use Radix primitives if it needs interactivity
3. Style with Tailwind classes referencing the token-based theme
4. Use `cva()` for variant management
5. Forward refs, use strict TypeScript
6. Add it to the styleguide page

### Modifying tokens

1. Edit `private/design-system.json`
2. Run `npx tsx scripts/generate-ui-from-json.ts`
3. Update `@theme inline` block in `app/globals.css` if new tokens were added
