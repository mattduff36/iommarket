"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminActionButton } from "@/components/admin/admin-action-controls";
import { Input } from "@/components/ui/input";
import { createRegion } from "@/actions/admin/regions";

export function CreateRegionForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = (form.get("name") as string).trim();
    const slug = (form.get("slug") as string).trim();
    const sortOrder = Number(form.get("sortOrder"));

    startTransition(async () => {
      const result = await createRegion({ name, slug, active: true, sortOrder });
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Validation error");
      } else {
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <Input label="Name" name="name" required minLength={2} maxLength={100} placeholder="e.g. IOM North" className="w-48" />
      <Input label="Slug" name="slug" required minLength={2} maxLength={100} placeholder="e.g. iom-north" className="w-48" />
      <Input label="Sort order" name="sortOrder" type="number" min={0} max={999} defaultValue={0} required className="w-28" />
      <AdminActionButton type="submit" disabled={isPending} tone="primary">
        Add Region
      </AdminActionButton>
      {error && <span className="text-xs text-text-error">{error}</span>}
    </form>
  );
}
