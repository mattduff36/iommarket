export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageEditor } from "./page-editor";

export const metadata: Metadata = { title: "Edit Page | Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminPageEditPage({ params }: Props) {
  const { id } = await params;

  if (id === "new") {
    return (
      <>
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/pages" className="text-sm text-text-secondary hover:text-text-primary">
            &larr; Pages
          </Link>
          <h1 className="text-2xl font-bold text-text-primary">New Page</h1>
        </div>
        <PageEditor />
      </>
    );
  }

  const page = await db.contentPage.findUnique({ where: { id } });
  if (!page) notFound();

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/pages" className="text-sm text-text-secondary hover:text-text-primary">
          &larr; Pages
        </Link>
        <h1 className="text-2xl font-bold text-text-primary">Edit: {page.title}</h1>
      </div>
      <PageEditor page={page} />
    </>
  );
}
