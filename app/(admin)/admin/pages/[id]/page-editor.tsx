"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upsertContentPage, deleteContentPage } from "@/actions/admin/pages";

interface PageEditorProps {
  page?: {
    id: string;
    slug: string;
    title: string;
    markdown: string;
    metaTitle: string | null;
    metaDescription: string | null;
    status: "DRAFT" | "PUBLISHED";
  };
}

export function PageEditor({ page }: PageEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await upsertContentPage({
        id: page?.id,
        slug: (form.get("slug") as string).trim(),
        title: (form.get("title") as string).trim(),
        markdown: (form.get("markdown") as string),
        metaTitle: (form.get("metaTitle") as string)?.trim() || undefined,
        metaDescription: (form.get("metaDescription") as string)?.trim() || undefined,
        status: (form.get("status") as "DRAFT" | "PUBLISHED") ?? "DRAFT",
      });

      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Validation error");
      } else {
        router.push("/admin/pages");
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!page) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteContentPage(page.id);
      if (result.error) {
        setError(typeof result.error === "string" ? result.error : "Failed");
      } else {
        router.push("/admin/pages");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <Input
        label="Title"
        name="title"
        required
        defaultValue={page?.title ?? ""}
        maxLength={200}
      />

      <Input
        label="Slug"
        name="slug"
        required
        defaultValue={page?.slug ?? ""}
        maxLength={100}
        placeholder="e.g. terms"
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="markdown" className="text-sm font-medium text-text-primary">
          Content (Markdown)
        </label>
        <textarea
          id="markdown"
          name="markdown"
          required
          rows={20}
          defaultValue={page?.markdown ?? ""}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-border-focus focus:shadow-outline"
        />
      </div>

      <Input
        label="Meta Title (optional)"
        name="metaTitle"
        defaultValue={page?.metaTitle ?? ""}
        maxLength={200}
      />

      <Input
        label="Meta Description (optional)"
        name="metaDescription"
        defaultValue={page?.metaDescription ?? ""}
        maxLength={500}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="status" className="text-sm font-medium text-text-primary">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={page?.status ?? "DRAFT"}
          className="flex h-10 w-48 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-border-focus focus:shadow-outline"
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
        </select>
      </div>

      {error && <p className="text-sm text-text-error">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending}>
          {page ? "Save Changes" : "Create Page"}
        </Button>

        {page && (
          <>
            {!showDelete ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDelete(true)}
                className="text-neon-red-400"
              >
                Delete
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-error">Delete this page?</span>
                <Button type="button" variant="ghost" onClick={handleDelete} disabled={isPending} className="text-neon-red-400">
                  Confirm
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowDelete(false)} disabled={isPending}>
                  Cancel
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );
}
