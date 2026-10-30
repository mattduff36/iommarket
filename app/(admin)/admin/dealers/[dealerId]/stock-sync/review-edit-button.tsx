"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStockSnapshotRefresh } from "../../../stock-reviews/use-stock-snapshot";
import { loadStockReviewVehicle, saveStockReviewVehicle } from "@/actions/admin/dealer-stock-review-edit";

type AttributeDefinition = {
  id: string;
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  options: string | null;
};

type DraftData = {
  draft: {
    title: string;
    description: string;
    pricePence: number | null;
    categorySlug: string;
    attributes: Record<string, string>;
    photoUrls: string[];
    sourceUrl: string | null;
    warning: string | null;
    flags: string[];
  };
  categories: Array<{ id: string; name: string; slug: string; attributes: AttributeDefinition[] }>;
};

function penceToPounds(pence: number | null) {
  if (pence == null) return "";
  const absolute = Math.abs(pence);
  return `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function poundsToPence(raw: string) {
  const trimmed = raw.trim().replaceAll("£", "").replaceAll(",", "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(pence) ? pence : null;
}

function selectOptions(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((option): option is string => typeof option === "string" && option.trim().length > 0);
  } catch {
    return [];
  }
}

function errorLines(error: unknown) {
  if (typeof error === "string") return [error];
  if (!error || typeof error !== "object") return ["Could not save this correction."];
  return Object.entries(error).flatMap(([key, value]) => {
    const text = Array.isArray(value) ? value.map(String).join(" ") : String(value);
    return [`${key}: ${text}`];
  });
}

function safeHttps(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? url : null;
  } catch {
    return null;
  }
}

export function StockReviewEditButton({
  reportId,
  fingerprint,
  sourceIdentityKey,
  label,
  override = false,
}: {
  reportId: string;
  fingerprint: string;
  sourceIdentityKey: string;
  label: string;
  override?: boolean;
}) {
  const router = useRouter();
  const reloadSnapshot = useStockSnapshotRefresh();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<DraftData | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState("");
  const [reason, setReason] = useState("");
  const [confirmAvailable, setConfirmAvailable] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function applyDraft(next: DraftData) {
    setData(next);
    setTitle(next.draft.title);
    setDescription(next.draft.description);
    setPrice(penceToPounds(next.draft.pricePence));
    setCategorySlug(next.draft.categorySlug);
    setAttributes(next.draft.attributes);
    setPhotos(next.draft.photoUrls.join("\n"));
    setReason("");
    setConfirmAvailable(false);
    setErrors([]);
  }

  function openEditor() {
    setErrors([]);
    startTransition(async () => {
      try {
        const result = await loadStockReviewVehicle({ reportId, fingerprint, sourceIdentityKey });
        if ("error" in result && result.error) {
          setErrors(errorLines(result.error));
          return;
        }
        if (!("data" in result) || !result.data) {
          setErrors(["Could not load this vehicle."]);
          return;
        }
        applyDraft(result.data);
      } catch {
        setErrors(["Could not load this vehicle. Check the connection and try again."]);
      }
    });
  }

  function cancel() {
    setData(null);
    setErrors([]);
    setReason("");
    setConfirmAvailable(false);
  }

  function save() {
    const pricePence = poundsToPence(price);
    const photoUrls = photos.split("\n").map((url) => url.trim()).filter(Boolean);
    if (pricePence == null) {
      setErrors(["price: Enter a price in pounds, such as 12500.00."]);
      return;
    }
    if (!confirmAvailable) {
      setErrors(["confirmAvailable: Confirm this vehicle is available."]);
      return;
    }
    setErrors([]);
    startTransition(async () => {
      try {
        const result = await saveStockReviewVehicle({
          reportId,
          fingerprint,
          sourceIdentityKey,
          categorySlug,
          title,
          description,
          price: pricePence,
          attributes: Object.fromEntries(Object.entries(attributes).filter(([, value]) => value.trim())),
          photoUrls,
          reason,
          confirmAvailable: true,
        });
        if ("error" in result && result.error) {
          setErrors(errorLines(result.error));
          return;
        }
        setData(null);
        if (reloadSnapshot) reloadSnapshot(); else router.refresh();
      } catch {
        setErrors(["The save outcome is uncertain. Your draft is still here. Check the saved result before trying again."]);
      }
    });
  }

  const category = data?.categories.find((item) => item.slug === categorySlug) ?? null;
  const source = safeHttps(data?.draft.sourceUrl ?? null);

  return (
    <div data-stock-review-editing={data || isPending ? "true" : undefined} className="mt-2">
      {data ? (
        <form
          className="space-y-3 rounded-md border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <fieldset className="space-y-3" disabled={isPending}>
            <legend className="text-sm font-semibold text-text-primary">Correct {label}</legend>
            {data.draft.warning ? <p className="text-sm text-text-secondary">Original warning: {data.draft.warning}</p> : null}
            {data.draft.flags.length > 0 ? <p className="text-sm text-text-secondary">Source checks: {data.draft.flags.join(", ")}</p> : null}
            <p className="text-sm text-text-secondary">
              Save corrections adds this vehicle to the eligible list. You still review and approve the full plan. Nothing is published or emailed now.
            </p>
            {source ? <a className="text-sm text-neon-blue-400 hover:underline" href={source} target="_blank" rel="noreferrer">Source listing</a> : null}
            <label className="block text-sm">Title<input className="mt-1 w-full rounded-md border border-border px-2 py-1" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
            <label className="block text-sm">Description<textarea className="mt-1 w-full rounded-md border border-border px-2 py-1" value={description} onChange={(event) => setDescription(event.target.value)} required rows={4} /></label>
            <label className="block text-sm">Price (GBP)<input className="mt-1 w-full rounded-md border border-border px-2 py-1" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
            <label className="block text-sm">Category
              <select className="mt-1 w-full rounded-md border border-border px-2 py-1" value={categorySlug} onChange={(event) => {
                const slug = event.target.value;
                const allowed = new Set(data.categories.find((item) => item.slug === slug)?.attributes.map((item) => item.slug) ?? []);
                setCategorySlug(slug);
                setAttributes((current) => Object.fromEntries(Object.entries(current).filter(([key]) => allowed.has(key))));
              }} required>
                <option value="">Choose a category</option>
                {data.categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
              </select>
            </label>
            {category?.attributes.map((attribute) => (
              <AttributeField
                key={attribute.id}
                attribute={attribute}
                value={attributes[attribute.slug] ?? ""}
                onChange={(value) => setAttributes((current) => ({ ...current, [attribute.slug]: value }))}
              />
            ))}
            <label className="block text-sm">Photo URLs, one per line<textarea className="mt-1 w-full rounded-md border border-border px-2 py-1" value={photos} onChange={(event) => setPhotos(event.target.value)} required rows={4} /></label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmAvailable} onChange={(event) => setConfirmAvailable(event.target.checked)} />
              This vehicle is available
            </label>
            <label className="block text-sm">Correction reason<textarea className="mt-1 w-full rounded-md border border-border px-2 py-1" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={1000} rows={3} /></label>
          </fieldset>
          {errors.length > 0 ? <div role="alert" className="text-sm text-text-error">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-neon-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={isPending}>{isPending ? "Saving corrections…" : "Save corrections"}</button>
            <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={cancel} disabled={isPending}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={openEditor} disabled={isPending}>
            {isPending ? "Loading review…" : override ? "Edit / override" : "Edit"}
          </button>
          {errors.length > 0 ? <div role="alert" className="mt-2 text-sm text-text-error">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
        </>
      )}
    </div>
  );
}

function AttributeField({
  attribute,
  value,
  onChange,
}: {
  attribute: AttributeDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const options = attribute.dataType === "select" ? selectOptions(attribute.options) : [];
  const label = `${attribute.name}${attribute.required ? " (required)" : ""}`;
  if (attribute.dataType === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input id={id} type="checkbox" checked={value === "true"} onChange={(event) => onChange(event.target.checked ? "true" : "false")} />
        {label}
      </label>
    );
  }
  if (options.length > 0) {
    return (
      <label className="block text-sm" htmlFor={id}>{label}
        <select id={id} className="mt-1 w-full rounded-md border border-border px-2 py-1" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="block text-sm" htmlFor={id}>{label}
      <input id={id} className="mt-1 w-full rounded-md border border-border px-2 py-1" inputMode={attribute.dataType === "number" ? "numeric" : "text"} value={value} onChange={(event) => onChange(event.target.value)} />
      {attribute.dataType === "select" ? <span className="text-text-tertiary"> Options could not be read. Enter the value exactly.</span> : null}
    </label>
  );
}
