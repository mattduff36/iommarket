import { unstable_noStore as noStore } from "next/cache";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requireRole } from "@/lib/auth";
import { desktopAccountEnabled } from "@/lib/dealer-stock-sync/desktop-config";
import {
  approveDesktopDevice,
  listDesktopDevices,
  liveDesktopDependencies,
  readDesktopInvitation,
  revokeDesktopDevice,
} from "@/lib/dealer-stock-sync/desktop-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Desktop stock worker | Admin" };

const STATUS_COPY: Record<string, string> = {
  authorised: "This computer can use the desktop stock worker.",
  denied: "That computer was not authorised.",
  revoked: "That computer's access has been removed.",
};

function browserRequest(headerList: Pick<Headers, "get">) {
  return {
    origin: headerList.get("origin"),
    host: headerList.get("host"),
    forwardedHost: headerList.get("x-forwarded-host"),
  };
}

async function authoriseComputer(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");
  const headerList = await headers();
  const result = await approveDesktopDevice(liveDesktopDependencies(), {
    ...browserRequest(headerList),
    adminId: admin.id,
    userCode: String(formData.get("userCode") ?? ""),
  });
  redirect(result.ok ? "/admin/stock-worker?status=authorised" : "/admin/stock-worker?status=denied");
}

async function revokeComputer(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");
  const headerList = await headers();
  const result = await revokeDesktopDevice(liveDesktopDependencies(), {
    ...browserRequest(headerList),
    adminId: admin.id,
    deviceId: String(formData.get("deviceId") ?? ""),
  });
  redirect(result.ok ? "/admin/stock-worker?status=revoked" : "/admin/stock-worker?status=denied");
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function StockWorkerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const admin = await requireRole("ADMIN");
  const query = await searchParams;
  const allowed = desktopAccountEnabled(process.env, admin.id);
  const status = STATUS_COPY[one(query.status)] ?? "";
  const code = one(query.code);
  const invitation = allowed ? await readDesktopInvitation(liveDesktopDependencies(), code) : null;
  const devices = allowed ? await listDesktopDevices(liveDesktopDependencies(), admin.id) : [];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Desktop stock worker"
        description="Authorise a named computer, then the desktop app can collect a 30-day session. Website sign-out does not remove that session."
      />
      {status ? <p className="text-sm text-text-secondary" role="status">{status}</p> : null}
      {!allowed ? (
        <p className="rounded-md border border-border bg-surface-secondary px-4 py-3 text-sm text-text-secondary" role="status">
          The desktop stock worker is unavailable for this account.
        </p>
      ) : (
        <>
          <section className="max-w-2xl space-y-3 rounded-md border border-border bg-surface-secondary px-4 py-4">
            <h2 className="text-lg font-semibold text-text-primary">Authorise a computer</h2>
            {invitation ? (
              <form action={authoriseComputer} className="space-y-3">
                <p className="text-sm text-text-secondary">
                  Check this computer before granting access. Do not approve a pairing you did not start. Submitting this form is the only way to approve it.
                </p>
                <dl className="space-y-1 text-sm text-text-primary">
                  <div className="flex gap-2"><dt className="text-text-tertiary">Computer</dt><dd>{invitation.deviceName}</dd></div>
                  <div className="flex gap-2"><dt className="text-text-tertiary">Environment</dt><dd>{invitation.environment}</dd></div>
                  <div className="flex gap-2"><dt className="text-text-tertiary">Code</dt><dd>{code}</dd></div>
                </dl>
                <input type="hidden" name="userCode" value={code} />
                <button type="submit" className="inline-flex h-10 items-center rounded-md bg-neon-blue-500 px-4 text-sm font-semibold text-white">
                  Authorise this computer
                </button>
              </form>
            ) : (
              <p className="text-sm text-text-tertiary">
                {code ? "This code is not valid or has expired." : "Open the link shown in the desktop app while you are signed in."}
              </p>
            )}
          </section>
          <section className="max-w-2xl space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">Your computers</h2>
            {devices.length === 0 ? <p className="text-sm text-text-tertiary">No authorised computers.</p> : (
              <ul className="space-y-2">
                {devices.map((device) => (
                  <li key={device.deviceId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
                    <span className="text-sm text-text-primary">{device.deviceName} · {device.environment}</span>
                    <form action={revokeComputer}>
                      <input type="hidden" name="deviceId" value={device.deviceId} />
                      <button type="submit" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-text-secondary">
                        Revoke
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
