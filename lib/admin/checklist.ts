import { SETTING_KEYS } from "@/lib/config/setting-keys";

export const CHECKLIST_SETTING_KEY = SETTING_KEYS.ADMIN_CHECKLIST;

export const CHECKLIST_ASSIGNEES = ["DM", "MD"] as const;
export type ChecklistAssignee = (typeof CHECKLIST_ASSIGNEES)[number];

export const CHECKLIST_LABELS = ["DM", "MD", "Future"] as const;
export type ChecklistLabel = (typeof CHECKLIST_LABELS)[number];

const KNOWN_LABELS = new Set<string>(CHECKLIST_LABELS);

export interface ChecklistItem {
  id: string;
  title: string;
  notes: string;
  labels: ChecklistLabel[];
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistSnapshot {
  items: ChecklistItem[];
  updatedAt: string;
}

export const DEFAULT_CHECKLIST_SEEDS: Array<{
  id: string;
  title: string;
  notes: string;
  labels: ChecklistLabel[];
}> = [
  {
    id: "seed-gdpr-advice",
    title: "GDPR advice",
    notes: "",
    labels: [],
  },
  {
    id: "seed-dealer-pause-cancel",
    title: "As a dealer, how do you pause or cancel your subscription?",
    notes:
      "What happens to active listings if this happens? Carry to end of month?",
    labels: [],
  },
  {
    id: "seed-website-terms",
    title: "Website T&Cs — avoid being an agent",
    notes: "Draft terms and conditions for the website.",
    labels: ["DM"],
  },
  {
    id: "seed-plate-checker-terms",
    title: "Plate checker terms & conditions",
    notes:
      "What this is based on. We take no responsibility for incorrect info being provided.",
    labels: ["DM"],
  },
  {
    id: "seed-founding-dealership",
    title: "Become a founding dealership and receive 3 months free Pro listings",
    notes: "Visit garages. Contact email address.",
    labels: ["DM"],
  },
  {
    id: "seed-listing-dropdowns",
    title: "Reduce listing page with dropdowns — see Autotrader",
    notes:
      "Potential look at reducing page with drop downs (performance, running cost etc).",
    labels: ["MD"],
  },
  {
    id: "seed-future-auction-scrap",
    title: "Auction (commission), scrap / parts",
    notes: "",
    labels: ["Future"],
  },
];

export function normalizeChecklistLabels(
  labels: unknown,
  legacyLabel?: unknown,
): ChecklistLabel[] {
  const collected: string[] = [];

  if (Array.isArray(labels)) {
    for (const entry of labels) {
      if (typeof entry === "string") collected.push(entry.trim());
    }
  } else if (typeof legacyLabel === "string" && legacyLabel.trim()) {
    collected.push(legacyLabel.trim());
  }

  const unique = new Set(
    collected.filter((entry): entry is ChecklistLabel => KNOWN_LABELS.has(entry)),
  );

  return CHECKLIST_LABELS.filter((label) => unique.has(label));
}

export function createChecklistItem(
  input: {
    title: string;
    notes?: string;
    labels?: readonly string[];
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
    labels: normalizeChecklistLabels(input.labels, input.label),
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

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isChecklistItemShape(value: unknown): value is Record<string, unknown> {
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
    typeof item.done === "boolean" &&
    isIsoDate(item.createdAt) &&
    isIsoDate(item.updatedAt)
  );
}

function hasValidStoredLabels(item: Record<string, unknown>) {
  if (item.labels === undefined) {
    return item.label === undefined || typeof item.label === "string";
  }
  return (
    Array.isArray(item.labels) &&
    item.labels.every(
      (label) => typeof label === "string" && KNOWN_LABELS.has(label),
    )
  );
}

export function parseStoredChecklistItems(
  value: unknown,
):
  | { success: true; items: ChecklistItem[] }
  | { success: false; error: string } {
  if (!Array.isArray(value)) {
    return { success: false, error: "Stored checklist is not an array." };
  }

  const ids = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const entry of value) {
    if (!isChecklistItemShape(entry) || !hasValidStoredLabels(entry)) {
      return {
        success: false,
        error: "Stored checklist contains a malformed entry.",
      };
    }
    const id = entry.id as string;
    if (ids.has(id)) {
      return {
        success: false,
        error: "Stored checklist contains duplicate item identifiers.",
      };
    }
    ids.add(id);
    items.push({
      id,
      title: (entry.title as string).trim(),
      notes: entry.notes as string,
      labels: normalizeChecklistLabels(entry.labels, entry.label),
      done: entry.done as boolean,
      createdAt: entry.createdAt as string,
      updatedAt: entry.updatedAt as string,
    });
  }

  return { success: true, items };
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
