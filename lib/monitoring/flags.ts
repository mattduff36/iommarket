type EnvLike = Record<string, string | undefined>;

function isExplicitlyDisabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off";
}

export function isConsoleCaptureEnabled(
  env: EnvLike = process.env,
): boolean {
  return !isExplicitlyDisabled(env.NEXT_PUBLIC_MONITORING_CAPTURE_CONSOLE);
}

export function isServerCaptureEnabled(
  env: EnvLike = process.env,
): boolean {
  return !isExplicitlyDisabled(env.MONITORING_CAPTURE_SERVER);
}

export function isEdgeRuntime(env: EnvLike = process.env): boolean {
  return env.NEXT_RUNTIME === "edge";
}
