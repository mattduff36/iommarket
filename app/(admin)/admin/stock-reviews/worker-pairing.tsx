import { headers } from "next/headers";
import { AuthoriseStockComputerButton } from "./authorise-button";
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

export async function StockWorkerPairing({ code, status, oracle = false }: { code: string; status: string; oracle?: boolean }) {
  if (!code) return status === "authorised" || status === "denied" ? <p role="status" className="rounded-lg border border-border p-4 text-sm text-text-secondary">{status === "authorised" ? "Device authorised. Its connection will appear here shortly." : "That device was not authorised. Request a new pairing invitation."}</p> : null;
  const admin = await requireRole("ADMIN");
  const invitation = desktopAccountEnabled(process.env, admin.id) ? await readDesktopInvitation(liveDesktopDependencies(), code) : null;
  const oracleInvitation = oracle && invitation?.deviceName === "Oracle Stock Update VM";
  return <section className={`space-y-3 rounded-xl border bg-surface-elevated p-4 ${oracleInvitation ? "border-border border-l-[3px] border-l-amber-400" : "border-neon-blue-500/40"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="text-lg font-semibold text-text-primary">{oracleInvitation ? "Approve Oracle Stock Update VM?" : "Connect your Stock Update app"}</h2>
      {oracleInvitation && <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">Approval required</span>}
    </div>
    {invitation ? <form action={authoriseStockComputer} className="space-y-3">
      <p className="text-sm text-text-secondary">Only authorise a sign-in you started. This grants this computer a 30-day session; signing out of the website does not revoke it.</p>
      <dl className="space-y-1 text-sm text-text-primary">
        <div><dt className="inline text-text-secondary">Computer: </dt><dd className="inline">{invitation.deviceName}</dd></div>
        <div><dt className="inline text-text-secondary">Environment: </dt><dd className="inline">{invitation.environment}</dd></div>
        <div><dt className="inline text-text-secondary">Code: </dt><dd className="inline font-mono">{code}</dd></div>
      </dl>
      <input type="hidden" name="userCode" value={code} />
      <div className="flex flex-wrap items-center gap-3"><AuthoriseStockComputerButton oracle={oracleInvitation} />
        {oracleInvitation && <a className="inline-flex min-h-11 items-center px-3 text-sm text-text-secondary hover:underline" href="/admin/stock-reviews">Cancel</a>}
      </div>
    </form> : <p role="status" className="text-sm text-text-secondary">This code is unavailable or expired. {oracle ? <a href="/admin/stock-reviews" className="text-neon-blue-400 hover:underline">Return to Dealer scrapes to request another invitation.</a> : "Start sign-in again in the app."}</p>}
    <a href="/admin/stock-worker" className="text-sm text-neon-blue-400 hover:underline">Manage authorised computers</a>
  </section>;
}
