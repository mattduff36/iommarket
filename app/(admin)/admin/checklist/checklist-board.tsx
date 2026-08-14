"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Plus, StickyNote, Trash2 } from "lucide-react";
import { saveChecklist } from "@/actions/admin/checklist";
import {
  createChecklistItem,
  remainingChecklistCount,
  sortChecklistItems,
  type ChecklistItem,
} from "@/lib/admin/checklist";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

interface ChecklistBoardProps {
  initialItems: ChecklistItem[];
}

function labelVariant(label: string | null) {
  if (label === "DM") return "info" as const;
  if (label === "MD") return "premium" as const;
  if (label === "Future") return "neutral" as const;
  return "neutral" as const;
}

export function ChecklistBoard({ initialItems }: ChecklistBoardProps) {
  const [items, setItems] = useState(initialItems);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const remaining = remainingChecklistCount(items);
  const visibleItems = useMemo(() => {
    const sorted = sortChecklistItems(items);
    return hideCompleted ? sorted.filter((item) => !item.done) : sorted;
  }, [hideCompleted, items]);

  function persist(nextItems: ChecklistItem[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveChecklist({ items: nextItems });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Could not save the checklist.",
        );
      }
    });
  }

  function updateItems(nextItems: ChecklistItem[]) {
    setItems(nextItems);
    persist(nextItems);
  }

  function handleToggle(id: string, done: boolean) {
    const now = new Date().toISOString();
    updateItems(
      items.map((item) =>
        item.id === id ? { ...item, done, updatedAt: now } : item,
      ),
    );
  }

  function handleTitleChange(id: string, title: string) {
    setItems(
      items.map((item) => (item.id === id ? { ...item, title } : item)),
    );
  }

  function handleTitleBlur(id: string) {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const title = current.title.trim();
    if (!title) {
      setError("An item needs a title.");
      return;
    }
    if (title === current.title) return;
    const nextItems = items.map((item) =>
      item.id === id
        ? { ...item, title, updatedAt: new Date().toISOString() }
        : item,
    );
    updateItems(nextItems);
  }

  function handleNotesChange(id: string, notes: string) {
    setItems(
      items.map((item) => (item.id === id ? { ...item, notes } : item)),
    );
  }

  function handleNotesBlur(id: string) {
    const nextItems = items.map((item) =>
      item.id === id
        ? { ...item, updatedAt: new Date().toISOString() }
        : item,
    );
    updateItems(nextItems);
  }

  function handleDelete(id: string) {
    updateItems(items.filter((item) => item.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const nextItems = [...items, createChecklistItem({ title })];
    setNewTitle("");
    updateItems(nextItems);
  }

  return (
    <div className="rounded-lg border border-border bg-surface shadow-low">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{remaining}</span>{" "}
          remaining
          {items.length > 0 ? ` of ${items.length}` : ""}
        </p>
        <AdminActionButton
          type="button"
          onClick={() => setHideCompleted((value) => !value)}
          aria-pressed={hideCompleted}
        >
          {hideCompleted ? "Show completed" : "Hide completed"}
        </AdminActionButton>
      </div>

      <ul className="divide-y divide-border">
        {visibleItems.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-text-secondary">
            {items.length === 0
              ? "Nothing here yet. Add the first item below."
              : "All caught up."}
          </li>
        ) : (
          visibleItems.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="pt-1">
                    <Checkbox
                      checked={item.done}
                      onCheckedChange={(checked) =>
                        handleToggle(item.id, checked === true)
                      }
                      aria-label={
                        item.done
                          ? `Mark ${item.title} as not done`
                          : `Mark ${item.title} as done`
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        value={item.title}
                        onChange={(event) =>
                          handleTitleChange(item.id, event.target.value)
                        }
                        onBlur={() => handleTitleBlur(item.id)}
                        aria-label={`Title for ${item.title}`}
                        className={cn(
                          "w-full bg-transparent text-sm text-text-primary outline-none",
                          item.done && "text-text-secondary line-through",
                        )}
                      />
                      {item.label ? (
                        <Badge variant={labelVariant(item.label)}>
                          {item.label}
                        </Badge>
                      ) : null}
                    </div>
                    {expanded ? (
                      <textarea
                        value={item.notes}
                        onChange={(event) =>
                          handleNotesChange(item.id, event.target.value)
                        }
                        onBlur={() => handleNotesBlur(item.id)}
                        aria-label={`Notes for ${item.title}`}
                        placeholder="Add notes…"
                        rows={3}
                        className="mt-2 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-neon-blue-500 focus:outline-none focus:shadow-glow-blue"
                      />
                    ) : item.notes ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(item.id)}
                        className="mt-1 line-clamp-2 w-full text-left text-xs text-text-secondary"
                      >
                        {item.notes}
                      </button>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(expanded ? null : item.id)
                      }
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Hide notes for ${item.title}`
                          : `Show notes for ${item.title}`
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                    >
                      <StickyNote className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label={`Delete ${item.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-neon-red-500/10 hover:text-neon-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>

      <form
        onSubmit={handleAdd}
        className="flex items-end gap-2 border-t border-border p-4"
      >
        <div className="flex-1">
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="New item"
            aria-label="New checklist item"
            maxLength={500}
          />
        </div>
        <AdminActionButton
          type="submit"
          tone="primary"
          disabled={isPending || newTitle.trim().length === 0}
        >
          <Plus className="h-3.5 w-3.5" />
          Add item
        </AdminActionButton>
      </form>

      {error ? (
        <p className="px-4 pb-4 text-sm text-text-error">{error}</p>
      ) : null}
    </div>
  );
}
