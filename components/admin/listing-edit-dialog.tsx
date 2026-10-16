"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadAdminListingForEdit, saveAdminListingEdit } from "@/actions/admin/listing-edit";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { transportPublicMessage } from "@/lib/forms/transport-public-error";
import { Input } from "@/components/ui/input";
import {
  firstFieldError,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { getAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import { CreateListingAttributeFields } from "@/app/(public)/sell/create-listing-attribute-fields";
import { pruneHiddenAttributes } from "@/app/(public)/sell/create-listing-form.helpers";

type ListingEditLoad = NonNullable<
  Extract<
    Awaited<ReturnType<typeof loadAdminListingForEdit>>,
    { data?: unknown }
  >["data"]
>;

interface ListingEditDialogProps {
  listingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function ListingEditDialog({
  listingId,
  open,
  onOpenChange,
  onSaved,
}: ListingEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<ListingEditLoad | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceText, setPriceText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setConfirmDiscard(false);
    setData(null);
    setLoadError(null);
    setError(null);
    setFieldErrors({});
    setConfirming(false);
    setLoading(true);

    void loadAdminListingForEdit(listingId).then((result) => {
      if (!active) return;
      if (result.error || !result.data) {
        setLoadError(
          typeof result.error === "string"
            ? result.error
            : "Unable to load this listing for editing.",
        );
        setLoading(false);
        return;
      }

      const loaded = result.data;
      setData(loaded);
      setTitle(loaded.listing.title);
      setDescription(loaded.listing.description);
      setPriceText((loaded.listing.price / 100).toFixed(2));
      setCategoryId(loaded.listing.categoryId);
      setRegionId(loaded.listing.regionId);
      setAttributeValues(
        Object.fromEntries(
          loaded.listing.attributes.map((attribute) => [
            attribute.attributeDefinitionId,
            attribute.value,
          ]),
        ),
      );
      setLoading(false);
    }).catch((caught: unknown) => {
      if (!active) return;
      const online = typeof navigator === "undefined" ? undefined : navigator.onLine;
      setLoadError(
        transportPublicMessage(caught, online) ??
          "We couldn't load this listing for editing. Try again shortly.",
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [listingId, open]);

  const selectedCategory = data?.categories.find((category) => category.id === categoryId);
  const visibleAttributes = useMemo(() => {
    if (!selectedCategory) return [];
    const valuesBySlug = Object.fromEntries(
      selectedCategory.attributes.map((attribute) => [
        attribute.slug,
        attributeValues[attribute.id]?.trim() ?? "",
      ]),
    );
    const retainedById =
      data && categoryId === data.listing.categoryId
        ? Object.fromEntries(
            data.listing.attributes.map((attribute) => [
              attribute.attributeDefinitionId,
              attribute.value,
            ]),
          )
        : {};
    return selectedCategory.attributes.flatMap((attr) => {
      const config = getAttributeFieldConfig(
        selectedCategory.slug,
        attr,
        valuesBySlug["fuel-type"] || undefined,
        { valuesBySlug, retainedValue: retainedById[attr.id] },
      );
      return config ? [{ attr, config }] : [];
    });
  }, [attributeValues, categoryId, data, selectedCategory]);

  function handleOpenChange(nextOpen: boolean) {
    if (saving.current && !nextOpen) return;
    if (!nextOpen && hasUnsavedChanges) {
      setConfirmDiscard(true);
      return;
    }
    if (!nextOpen) setConfirming(false);
    onOpenChange(nextOpen);
  }

  const hasUnsavedChanges = Boolean(data && (
    title !== data.listing.title ||
    description !== data.listing.description ||
    priceText !== (data.listing.price / 100).toFixed(2) ||
    categoryId !== data.listing.categoryId ||
    regionId !== data.listing.regionId ||
    JSON.stringify(attributeValues) !== JSON.stringify(Object.fromEntries(
      data.listing.attributes.map((attribute) => [attribute.attributeDefinitionId, attribute.value]),
    ))
  ));

  function discardAndClose() {
    if (saving.current) return;
    setConfirmDiscard(false);
    setConfirming(false);
    onOpenChange(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    setError(null);
    setFieldErrors({});
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (!data) return;

    const price = priceText.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(price)) {
      setError("Enter a price with no more than two decimal places.");
      setConfirming(false);
      return;
    }
    const pricePence = Math.round(Number(price) * 100);
    const submittedValues = selectedCategory
      ? pruneHiddenAttributes(attributeValues, selectedCategory)
      : attributeValues;
    const attributes = (selectedCategory?.attributes ?? []).flatMap((attribute) => {
      const value = submittedValues[attribute.id]?.trim();
      return value ? [{ attributeDefinitionId: attribute.id, value }] : [];
    });

    saving.current = true;
    startTransition(async () => {
      try {
      const result = await saveAdminListingEdit({
        listingId,
        expectedLifecycleRevision: data.listing.lifecycleRevision,
        expectedUpdatedAt: data.listing.updatedAt,
        title,
        description,
        price: pricePence,
        categoryId,
        regionId,
        attributes,
      });
      if (result.error) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setError(
          split.formError ??
            (Object.keys(split.fieldErrors).length > 0
              ? null
              : "Unable to save listing changes. Refresh and try again."),
        );
        setConfirming(false);
        return;
      }

      setConfirming(false);
      onOpenChange(false);
      onSaved?.();
      router.refresh();
      } catch {
        setError("Unable to save listing changes. Your edits are still here; please try again.");
        setConfirming(false);
      } finally {
        saving.current = false;
      }
    });
  }

  const blockedByRevision = data?.hasOpenRevision === true;
  const messages = uniqueErrorMessages(fieldErrors, loadError ?? error);

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit listing details</DialogTitle>
          <DialogDescription>
            Admin changes save immediately. Listing status, payment, seller details, and photos stay unchanged.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-sm text-text-secondary" role="status">
            Loading listing details…
          </p>
        ) : loadError ? (
          <FormErrorSummary messages={[loadError]} cause="service" />
        ) : data ? (
          <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-5">
            <FormErrorSummary messages={messages} />
            {blockedByRevision ? (
              <div className="rounded-md border border-premium-gold-500/30 bg-premium-gold-500/5 p-3 text-sm text-text-primary" role="alert">
                A seller revision is {data.openRevisionStatus?.toLowerCase()} and must be resolved before these listing details can be edited.
              </div>
            ) : null}

            <fieldset disabled={isPending || confirming || blockedByRevision} className="space-y-4">
              <Input
                label="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                minLength={5}
                maxLength={120}
                error={firstFieldError(fieldErrors, "title")}
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="admin-listing-description" className="text-sm font-medium text-text-primary">
                  Description
                </label>
                <AdminActionTextarea
                  id="admin-listing-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  minLength={20}
                  maxLength={5000}
                  rows={7}
                  aria-invalid={firstFieldError(fieldErrors, "description") ? true : undefined}
                />
                {firstFieldError(fieldErrors, "description") ? (
                  <p className="text-xs text-text-error">{firstFieldError(fieldErrors, "description")}</p>
                ) : null}
              </div>
              <Input
                label="Price (£)"
                type="number"
                min="1"
                max="1000000"
                step="0.01"
                value={priceText}
                onChange={(event) => setPriceText(event.target.value)}
                required
                error={firstFieldError(fieldErrors, "price")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="admin-listing-category" className="text-sm font-medium text-text-primary">Category</label>
                  <AdminActionSelect
                    id="admin-listing-category"
                    value={categoryId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setCategoryId(nextId);
                      const nextCategory = data.categories.find((category) => category.id === nextId);
                      const allowedIds = new Set(nextCategory?.attributes.map((attribute) => attribute.id) ?? []);
                      setAttributeValues((current) => {
                        const allowed = Object.fromEntries(
                          Object.entries(current).filter(([id]) => allowedIds.has(id)),
                        );
                        return nextCategory ? pruneHiddenAttributes(allowed, nextCategory) : allowed;
                      });
                    }}
                    required
                  >
                    <option value="">Select a category</option>
                    {data.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </AdminActionSelect>
                  {firstFieldError(fieldErrors, "categoryId") ? (
                    <p className="text-xs text-text-error">{firstFieldError(fieldErrors, "categoryId")}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="admin-listing-region" className="text-sm font-medium text-text-primary">Region</label>
                  <AdminActionSelect
                    id="admin-listing-region"
                    value={regionId}
                    onChange={(event) => setRegionId(event.target.value)}
                    required
                  >
                    <option value="">Select a region</option>
                    {data.regions.map((region) => (
                      <option key={region.id} value={region.id}>{region.name}</option>
                    ))}
                  </AdminActionSelect>
                  {firstFieldError(fieldErrors, "regionId") ? (
                    <p className="text-xs text-text-error">{firstFieldError(fieldErrors, "regionId")}</p>
                  ) : null}
                </div>
              </div>

              {selectedCategory ? (
                <section className="space-y-3 rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold text-text-primary">Listing attributes</h3>
                  <CreateListingAttributeFields
                    categorySlug={selectedCategory.slug}
                    visibleAttributes={visibleAttributes}
                    attributeValues={attributeValues}
                    isDetailsStep
                    getFieldError={(field) => firstFieldError(fieldErrors, field)}
                    onAttributeChange={(attribute, value) =>
                      setAttributeValues((current) => {
                        const nextValues = { ...current, [attribute.id]: value };
                        return selectedCategory
                          ? pruneHiddenAttributes(nextValues, selectedCategory)
                          : nextValues;
                      })
                    }
                  />
                </section>
              ) : null}
            </fieldset>

            <p className="rounded-md border border-border bg-canvas/40 p-3 text-xs leading-5 text-text-secondary">
              Photos are read-only here ({data.listing.photoCount}). This editor cannot add, remove, or reorder listing images.
            </p>

            {confirming ? (
              <div className="rounded-md border border-premium-gold-500/30 bg-premium-gold-500/5 p-3 text-sm text-text-primary" role="alert">
                {data.listing.status === "LIVE"
                  ? "Confirm this edit. The changed details will appear on the public listing immediately."
                  : "Confirm this edit. The changed listing details will be saved immediately."}
              </div>
            ) : null}

            <DialogFooter>
              {confirming ? (
                <>
                  <AdminActionButton disabled={isPending} onClick={() => setConfirming(false)}>
                    Back to editing
                  </AdminActionButton>
                  <AdminActionButton type="submit" tone="primary" disabled={isPending || blockedByRevision}>
                    {isPending ? "Saving…" : "Confirm save"}
                  </AdminActionButton>
                </>
              ) : (
                <>
                  <AdminActionButton disabled={isPending} onClick={() => handleOpenChange(false)}>
                    Cancel
                  </AdminActionButton>
                  <AdminActionButton type="submit" tone="primary" disabled={isPending || blockedByRevision}>
                    Review and save
                  </AdminActionButton>
                </>
              )}
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
    <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>Your listing edits have not been saved.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <AdminActionButton onClick={() => setConfirmDiscard(false)}>Keep editing</AdminActionButton>
          <AdminActionButton tone="primary" onClick={discardAndClose}>Discard changes</AdminActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
