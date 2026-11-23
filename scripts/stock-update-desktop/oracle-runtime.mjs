const targets = Object.freeze({
  preview: Object.freeze({ environment: "preview", label: "Preview", origin: "https://itrader.dev" }),
  production: Object.freeze({ environment: "production", label: "Production", origin: "https://itrader.im" }),
});

export function oracleTarget(environment = "preview") {
  if (!Object.hasOwn(targets, environment)) throw new Error("Unknown Oracle stock environment");
  return targets[environment];
}

export function oracleSessionFile(target, profile) {
  if (profile !== "admin1" && profile !== "admin2") throw new Error("Choose the admin1 or admin2 pairing profile");
  return "/var/lib/itrader-stock-" + target.environment + "-" + profile + "/session.json";
}
