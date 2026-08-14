import { SETTING_KEYS } from "@/lib/config/setting-keys";

export const CHECKLIST_SETTING_KEY = SETTING_KEYS.ADMIN_CHECKLIST;

export interface ChecklistItem {
  id: string;
  title: string;
  notes: string;
  label: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_CHECKLIST_SEEDS: Array<{
  id: string;
  title: string;
  notes: string;
  label: string | null;
}> = [
  {
    id: "seed-gdpr-advice",
    title: "GDPR advice",
    notes: "",
    label: null,
  },
  {
    id: "seed-dealer-pause-cancel",
    title: "As a dealer, how do you pause or cancel your subscription?",
    notes:
      "What happens to active listings if this happens? Carry to end of month?",
    label: null,
  },
  {
    id: "seed-website-terms",
    title: "Website T&Cs — avoid being an agent",
    notes: "Draft terms and conditions for the website.",
    label: "DM",
  },
  {
    id: "seed-plate-checker-terms",
    title: "Plate checker terms & conditions",
    notes:
      "What this is based on. We take no responsibility for incorrect info being provided.",
    label: "DM",
  },
  {
    id: "seed-founding-dealership",
    title: "Become a founding dealership and receive 3 months free Pro listings",
    notes: "Visit garages. Contact email address.",
    label: "DM",
  },
  {
    id: "seed-listing-dropdowns",
    title: "Reduce listing page with dropdowns — see Autotrader",
    notes:
      "Potential look at reducing page with drop downs (performance, running cost etc).",
    label: "MD",
  },
  {
    id: "seed-future-auction-scrap",
    title: "Auction (commission), scrap / parts",
    notes: "",
    label: "Future",
  },
];

export function createChecklistItem(
  input: {
    title: string;
    notes?: string;
    label?: string | null;
    id?: string;
    done?: boolean;
  },
  now = new Date(),
): ChecklistItem {
  const iso = now.toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    title: input.title.trim(),
    notes: (input.notes ?? "").trim(),
    label: input.label?.trim() || null,
    done: input.done ?? false,
    createdAt: iso,
    updatedAt: iso,
  };
}

export function createDefaultChecklistItems(now = new Date()): ChecklistItem[] {
  return DEFAULT_CHECKLIST_SEEDS.map((seed, index) =>
    createChecklistItem(seed, new Date(now.getTime() + index)),
  );
}

function isChecklistItem(value: unknown): value is ChecklistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    item.id.length <= 80 &&
    typeof item.title === "string" &&
    item.title.trim().length > 0 &&
    item.title.length <= 500 &&
    typeof item.notes === "string" &&
    item.notes.length <= 5000 &&
    (item.label === null ||
      (typeof item.label === "string" && item.label.length <= 40)) &&
    typeof item.done === "boolean" &&
    typeof item.createdAt === "string" &&
    !Number.isNaN(Date.parse(item.createdAt)) &&
    typeof item.updatedAt === "string" &&
    !Number.isNaN(Date.parse(item.updatedAt))
  );
}

export function resolveChecklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) {
    return createDefaultChecklistItems();
  }

  return value.flatMap((entry) => {
    if (!isChecklistItem(entry)) return [];
    return [
      {
        id: entry.id,
        title: entry.title.trim(),
        notes: entry.notes,
        label: typeof entry.label === "string" ? entry.label.trim() || null : null,
        done: entry.done,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
    ];
  });
}

export function sortChecklistItems(items: ChecklistItem[]): ChecklistItem[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function remainingChecklistCount(items: ChecklistItem[]): number {
  return items.filter((item) => !item.done).length;
}
