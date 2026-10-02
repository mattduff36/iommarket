export function maskMonitoringIdentity(value: string | null | undefined): string {
  if (!value) return "anonymous";
  if (value.includes("@")) {
    const [local = "", domain = ""] = value.split("@");
    const visible = local.slice(0, 2);
    return `${visible || "••"}***@${domain}`;
  }
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function monitoringIdentity(value: string | null | undefined, reveal: boolean): string {
  if (!value) return "anonymous";
  return reveal ? value : maskMonitoringIdentity(value);
}
