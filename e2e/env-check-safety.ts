export function assertEnvCheckSafety(params: {
  destructiveChecksEnabled: string | undefined;
  targetAttestation: string | undefined;
  baseUrl: string;
  blockedBaseUrls?: readonly (string | undefined)[];
}): void {
  if (
    params.destructiveChecksEnabled !== "1" ||
    params.targetAttestation !== "non-production"
  ) {
    throw new Error(
      "Environment checks are destructive. Set ALLOW_DESTRUCTIVE_ENV_CHECKS=1 and E2E_ENV_CHECK_TARGET=non-production explicitly.",
    );
  }

  const normalizeHostname = (value: string): string =>
    new URL(value.includes("://") ? value : `https://${value}`)
      .hostname.toLowerCase()
      .replace(/\.+$/, "");
  const isLoopbackHostname = (hostname: string): boolean => {
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
    return (
      unwrappedHostname === "localhost" ||
      unwrappedHostname.endsWith(".localhost") ||
      unwrappedHostname === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(unwrappedHostname)
    );
  };

  const hostname = normalizeHostname(params.baseUrl);
  const blockedHostnames = (params.blockedBaseUrls ?? [])
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeHostname)
    .filter((blockedHostname) => !isLoopbackHostname(blockedHostname));
  const matchesBlockedHost = (blockedHostname: string): boolean =>
    hostname === blockedHostname || hostname.endsWith(`.${blockedHostname}`);

  if (
    hostname === "itrader.im" ||
    hostname.endsWith(".itrader.im") ||
    hostname === "vercel.app" ||
    hostname.endsWith(".vercel.app") ||
    blockedHostnames.some(matchesBlockedHost)
  ) {
    throw new Error("Environment checks are blocked against the production domain.");
  }
}
