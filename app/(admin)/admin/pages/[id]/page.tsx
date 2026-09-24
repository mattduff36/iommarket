export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
        <AdminPageHeader
          title="New page"
          description="Create a marketplace content page and choose when it is ready to publish."
          actions={
            <Link
              href="/admin/pages"
              className="text-sm font-medium text-text-secondary hover:text-text-primary"
            >
              &larr; All pages
            </Link>
          }
        />
        <PageEditor />
      </>
    );
  }

  const page = await db.contentPage.findUnique({ where: { id } });
  if (!page) notFound();

  return (
    <>
      <AdminPageHeader
        title={page.title}
        description="Edit page content, search metadata, and publication status."
        meta={<span>{page.status === "PUBLISHED" ? "Published" : "Draft"}</span>}
        actions={
          <Link
            href="/admin/pages"
            className="text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            &larr; All pages
          </Link>
        }
      />
      <PageEditor page={page} />
    </>
  );
}
