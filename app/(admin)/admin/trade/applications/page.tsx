import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { db } from "@/lib/db";
import { isTradeExchangeEnabled } from "@/lib/trade-exchange/flag";

export default async function AdminTradeApplicationsPage() {
  if (!isTradeExchangeEnabled()) notFound();
  const applications = await db.tradeMembership.findMany({
    orderBy: { submittedAt: "desc" },
    select: { id: true, status: true, businessName: true, duplicateRegistration: true, submittedAt: true },
  });
  return (
    <section>
      <AdminPageHeader title="Trade applications" description="Business verification is separate from the public dealer badge and the subscription." />
      <ul className="divide-y divide-border rounded-xl border border-border">
        {applications.length === 0 ? <li className="p-4 text-sm text-text-secondary">No applications.</li> : applications.map((application) => (
          <li key={application.id} className="p-4">
            <Link className="font-medium underline" href={`/admin/trade/applications/${application.id}`}>{application.businessName}</Link>
            <p className="text-sm text-text-secondary">{application.status}{application.duplicateRegistration ? " · duplicate registration" : ""}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
