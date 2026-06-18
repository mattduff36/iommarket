"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createAttributeDefinition } from "@/actions/admin";
import { Input } from "@/components/ui/input";
import {
  AdminActionButton,
  AdminActionSelect,
  AdminActionTextarea,
} from "@/components/admin/admin-action-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface Category {
  id: string;
  name: string;
}

interface Props {
  categories: Category[];
}

const DATA_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select (dropdown)" },
  { value: "boolean", label: "Boolean (yes/no)" },
] as const;

function toSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function AddAttributeForm({ categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dataType, setDataType] = useState<string>("text");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [required, setRequired] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");

  useEffect(() => {
    if (!slugEdited) {
      setSlug(toSlug(name));
    }
  }, [name, slugEdited]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const options = form.get("options") as string | null;

    let encodedOptions: string | null = null;
    if (dataType === "select" && options) {
      const items = options
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      encodedOptions = JSON.stringify(items);
    }

    startTransition(async () => {
      const result = await createAttributeDefinition({
        categoryId,
        name,
        slug,
        dataType: dataType as "text" | "number" | "select" | "boolean",
        required,
        options: encodedOptions,
      });

      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to create attribute"
        );
      } else {
        router.refresh();
        setName("");
        setSlug("");
        setSlugEdited(false);
        setDataType("text");
        setRequired(false);
        setError(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Attribute</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text-primary">Category</label>
            <AdminActionSelect
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-10 w-full text-sm"
              required
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </AdminActionSelect>
          </div>

          {/* Name + auto-slug */}
          <Input
            label="Attribute Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={60}
            placeholder="e.g. Engine Size"
          />
          <Input
            label="Slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
            required
            minLength={2}
            maxLength={60}
            pattern="[a-z0-9-]+"
            helperText="Auto-generated — lowercase, numbers, hyphens only"
            placeholder="e.g. engine-size"
          />

          {/* Data Type */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text-primary">Data Type</label>
            <AdminActionSelect
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              className="h-10 w-full text-sm"
            >
              {DATA_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </AdminActionSelect>
          </div>

          {/* Options — only for select type */}
          {dataType === "select" && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-text-primary">Options</label>
              <AdminActionTextarea
                name="options"
                rows={3}
                placeholder="Comma-separated, e.g. Petrol, Diesel, Electric"
                className="resize-none text-sm"
              />
              <p className="text-xs text-text-secondary">Separate each option with a comma</p>
            </div>
          )}

          {/* Required */}
          <Checkbox
            label="Required field"
            checked={required}
            onCheckedChange={(v) => setRequired(Boolean(v))}
          />

          {error && <p className="text-sm text-text-error">{error}</p>}

          <AdminActionButton
            type="submit"
            disabled={isPending}
            tone="primary"
            className="w-full"
          >
            Add Attribute
          </AdminActionButton>
        </form>
      </CardContent>
    </Card>
  );
}
