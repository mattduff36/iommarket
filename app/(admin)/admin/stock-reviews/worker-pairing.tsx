import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { desktopAccountEnabled } from "@/lib/dealer-stock-sync/desktop-config";
import { approveDesktopDevice, liveDesktopDependencies, readDesktopInvitation } from "@/lib/dealer-stock-sync/desktop-service";

export async function authoriseStockComputer(form: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");
  const request = await headers();
  const result = await approveDesktopDevice(liveDesktopDependencies(), {
    adminId: admin.id, userCode: String(form.get("userCode") ?? ""),
    origin: request.get("origin"), host: request.get("host"), forwardedHost: request.get("x-forwarded-host"),
  });
  redirect(`/admin/stock-reviews?status=${result.ok ? "authorised" : "denied"}`);
}

export async function StockWorkerPairing({ code, status }: { code: string; status: string }) {
  if (!code) return status === "authorised" || status === "denied" ? <p role="status" className="rounded-lg border border-border p-4 text-sm text-text-secondary">{status === "authorised" ? "Computer authorised. Keep the Stock Update app open; its connection will appear here shortly." : "That computer was not authorised. Start sign-in again in the app."}</p> : null;
  const admin = await requireRole("ADMIN");
  const invitation = desktopAccountEnabled(process.env, admin.id) ? await readDesktopInvitation(liveDesktopDependencies(), code) : null;
  return <section className="space-y-3 rounded-xl border border-neon-blue-500/40 bg-surface-secondary p-4">
    <h2 className="text-lg font-semibold text-text-primary">Connect your Stock Update app</h2>
    {invitation ? <form action={authoriseStockComputer} className="space-y-3">
      <p className="text-sm text-text-secondary">Only authorise a sign-in you started. This grants this computer a 30-day session; signing out of the website does not revoke it.</p>
      <dl className="space-y-1 text-sm text-text-primary">
        <div><dt className="inline text-text-secondary">Computer: </dt><dd className="inline">{invitation.deviceName}</dd></div>
        <div><dt className="inline text-text-secondary">Environment: </dt><dd className="inline">{invitation.environment}</dd></div>
        <div><dt className="inline text-text-secondary">Code: </dt><dd className="inline font-mono">{code}</dd></div>
      </dl>
      <input type="hidden" name="userCode" value={code} />
      <button type="submit" className="rounded-md bg-neon-blue-500 px-4 py-2 text-sm font-semibold text-white">Authorise this computer</button>
    </form> : <p role="status" className="text-sm text-text-secondary">This code is unavailable or expired. Start sign-in again in the app.</p>}
    <a href="/admin/stock-worker" className="text-sm text-neon-blue-400 hover:underline">Manage authorised computers</a>
  </section>;
}
