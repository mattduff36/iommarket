import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ListingAttributeFieldConfig } from "@/lib/listings/attribute-ui";
import { isDetailsAttributeRequired } from "./create-listing-form.validation";

export interface ListingAttributeDef {
  id: string;
  name: string;
  slug: string;
  dataType: string;
  required: boolean;
  options: string | null;
}

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
  return (
    <>
      {visibleAttributes.map(({ attr, config }) => {
        const fieldName = `attr-${attr.id}`;
        const fieldError = getFieldError(fieldName);
        const isRequired = isDetailsAttributeRequired(
          categorySlug,
          attr,
          enforceListingNs,
        );

        if (config.control === "select") {
          return (
            <div key={attr.id} className="flex flex-col gap-1">
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
                aria-describedby={fieldError ? `${fieldName}-error` : undefined}
                className={`flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline ${
                  fieldError ? "border-neon-red-500" : "border-border"
                }`}
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
              {fieldError ? (
                <p id={`${fieldName}-error`} className="text-xs text-text-energy">
                  {fieldError}
                </p>
              ) : config.helperText ? (
                <p className="text-xs text-text-secondary">{config.helperText}</p>
              ) : null}
            </div>
          );
        }

        if (config.control === "checkbox") {
          return (
            <div key={attr.id} className="space-y-2">
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
            key={attr.id}
            id={fieldName}
            label={attr.name}
            name={fieldName}
            required={isDetailsStep && isRequired}
            type={config.control === "number" ? "number" : "text"}
            value={attributeValues[attr.id] ?? ""}
            onChange={(event) => onAttributeChange(attr, event.target.value)}
            min={config.min}
            max={config.max}
            step={config.step}
            inputMode={config.inputMode}
            placeholder={config.placeholder}
            helperText={config.helperText}
            error={fieldError}
          />
        );
      })}
    </>
  );
}
