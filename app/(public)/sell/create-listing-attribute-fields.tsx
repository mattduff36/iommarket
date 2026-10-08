"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ListingAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import { partitionByDetailGroup } from "@/lib/listings/vehicle-detail-catalog";
import { isDetailsAttributeRequired } from "./create-listing-form.validation";

export interface ListingAttributeDef {
  id: string;
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  options: string | null;
}

const controlClassName =
  "flex h-10 w-full min-w-0 max-w-full rounded-md border bg-surface px-3 py-2 text-base text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline md:text-sm";

export function ListingFieldLabel({
  label,
  required = false,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <>
      {label}
      {required ? (
        <span aria-hidden="true" className="text-text-error">
          {" "}
          *
        </span>
      ) : null}
    </>
  );
}

export function CreateListingAttributeFields({
  categorySlug,
  visibleAttributes,
  attributeValues,
  isDetailsStep,
  enforceListingNs,
  getFieldError,
  onAttributeChange,
}: {
  categorySlug: string;
  visibleAttributes: Array<{
    attr: ListingAttributeDef;
    config: ListingAttributeFieldConfig;
  }>;
  attributeValues: Record<string, string>;
  isDetailsStep: boolean;
  enforceListingNs?: boolean;
  getFieldError: (fieldName: string) => string | undefined;
  onAttributeChange: (attribute: ListingAttributeDef, value: string) => void;
}) {
  const partitioned = partitionByDetailGroup(
    categorySlug,
    visibleAttributes,
    (field) => field.attr.slug,
  );
  const fieldProps = {
    categorySlug,
    attributeValues,
    isDetailsStep,
    enforceListingNs,
    getFieldError,
    onAttributeChange,
  };

  return (
    <div className="min-w-0 space-y-4">
      {partitioned.essentials.map((field) => (
        <ListingAttributeControl key={field.attr.id} field={field} {...fieldProps} />
      ))}
      {partitioned.groups.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-text-primary">Additional details</h4>
          <p className="text-xs text-text-secondary">
            Optional. Leave a field blank to clear it. Unknown is not the same as No.
          </p>
          {partitioned.groups.map((group) => {
            const hasError = group.items.some((field) =>
              Boolean(getFieldError(`attr-${field.attr.id}`)),
            );
            const hasValue = group.items.some((field) =>
              Boolean(attributeValues[field.attr.id]?.trim()),
            );
            return (
              <AdditionalDetailGroup
                key={group.id}
                title={group.title}
                initiallyOpen={hasError || hasValue}
                forceOpen={hasError}
              >
                {group.items.map((field) => (
                  <ListingAttributeControl key={field.attr.id} field={field} {...fieldProps} />
                ))}
              </AdditionalDetailGroup>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AdditionalDetailGroup({
  title,
  initiallyOpen,
  forceOpen,
  children,
}: {
  title: string;
  initiallyOpen: boolean;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    if (!opened.current && initiallyOpen) {
      details.open = true;
      opened.current = true;
    }
    if (forceOpen) details.open = true;
  }, [forceOpen, initiallyOpen]);

  return (
    <details ref={detailsRef} className="min-w-0 rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold text-text-primary">{title}</summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}

function ListingAttributeControl({
  categorySlug,
  field,
  attributeValues,
  isDetailsStep,
  enforceListingNs,
  getFieldError,
  onAttributeChange,
}: {
  categorySlug: string;
  field: { attr: ListingAttributeDef; config: ListingAttributeFieldConfig };
  attributeValues: Record<string, string>;
  isDetailsStep: boolean;
  enforceListingNs?: boolean;
  getFieldError: (fieldName: string) => string | undefined;
  onAttributeChange: (attribute: ListingAttributeDef, value: string) => void;
}) {
  const { attr, config } = field;
  const fieldName = `attr-${attr.id}`;
  const fieldError = getFieldError(fieldName);
  const isRequired = isDetailsAttributeRequired(categorySlug, attr, enforceListingNs);
  const describedBy = fieldError
    ? `${fieldName}-error`
    : config.helperText
      ? `${fieldName}-help`
      : undefined;

  if (config.control === "select") {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={fieldName} className="text-sm font-medium text-text-primary">
          <ListingFieldLabel label={attr.name} required={isRequired} />
        </label>
        <select
          id={fieldName}
          name={fieldName}
          required={isDetailsStep && isRequired}
          value={attributeValues[attr.id] ?? ""}
          onChange={(event) => onAttributeChange(attr, event.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={describedBy}
          className={`${controlClassName} ${fieldError ? "border-neon-red-500" : "border-border"}`}
        >
          <option value="">
            {attr.slug === "make" ? "Select a make" : `Select ${attr.name.toLowerCase()}`}
          </option>
          {config.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <FieldMessage id={describedBy} error={fieldError} helperText={config.helperText} />
      </div>
    );
  }

  if (config.control === "checkbox") {
    return (
      <div className="space-y-2">
        <input type="hidden" name={fieldName} value={attributeValues[attr.id] ?? ""} />
        <Checkbox
          id={fieldName}
          checked={attributeValues[attr.id] === "true"}
          onCheckedChange={(checked) =>
            onAttributeChange(attr, checked === true ? "true" : "")
          }
          required={isDetailsStep && isRequired}
          label={attr.name}
        />
        {fieldError ? (
          <p id={`${fieldName}-error`} className="text-xs text-text-energy">
            {fieldError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Input
      id={fieldName}
      label={attr.name}
      name={fieldName}
      required={isDetailsStep && isRequired}
      type={config.control === "number" ? "number" : config.control === "date" ? "date" : "text"}
      value={attributeValues[attr.id] ?? ""}
      onChange={(event) => onAttributeChange(attr, event.target.value)}
      min={config.control === "date" ? config.minDate : config.min}
      max={config.control === "date" ? config.maxDate : config.max}
      step={config.step}
      maxLength={config.maxLength}
      inputMode={config.inputMode}
      placeholder={config.placeholder}
      helperText={config.helperText}
      error={fieldError}
      className="text-base md:text-sm"
    />
  );
}

function FieldMessage({
  id,
  error,
  helperText,
}: {
  id?: string;
  error?: string;
  helperText?: string;
}) {
  if (!error && !helperText) return null;
  return (
    <p id={id} className={error ? "text-xs text-text-energy" : "text-xs text-text-secondary"}>
      {error || helperText}
    </p>
  );
}
