"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategory } from "@/actions/admin";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  parentCategories: Array<{ id: string; name: string }>;
}

export function CreateCategoryForm({ parentCategories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createCategory({
        name: form.get("name") as string,
        slug: form.get("slug") as string,
        parentId: (form.get("parentId") as string) || null,
        active: true,
      });

      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Failed to create category"
        );
      } else {
        router.refresh();
        (e.target as HTMLFormElement).reset();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Category</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Name" name="name" required minLength={2} maxLength={60} />
          <Input
            label="Slug"
            name="slug"
            required
            minLength={2}
            maxLength={60}
            pattern="[a-z0-9-]+"
            helperText="Lowercase letters, numbers, and hyphens only"
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-text-primary">
              Parent Category
            </label>
            <select
              name="parentId"
              className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline"
            >
              <option value="">None (top-level)</option>
              {parentCategories.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-text-error">{error}</p>}
          <Button type="submit" loading={isPending} className="w-full">
            Create Category
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
