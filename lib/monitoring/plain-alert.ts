import { matchPlainAlert, type PlainAlertMatch } from "./plain-alert-rules";
import type { MonitoringSeverity } from "./types";

export interface PlainMonitoringAlertInput {
  title: string;
  message: string;
  route?: string | null;
  action?: string | null;
  environment?: string | null;
  occurrences?: number;
  severity?: MonitoringSeverity;
  omitCount?: boolean;
}

export interface PlainMonitoringAlert {
  subject: string;
  summary: string;
  check: string;
}

const ROUTE_LABELS: Array<[RegExp, string]> = [
  [/^\/api\/me$/, "the account check"],
  [/^\/account(?:\/|$)/, "the account page"],
  [/^\/api\/webhooks\/payments$/, "payment notices"],
  [/^\/admin\/payments$/, "the payments page"],
  [/^\/admin\/users$/, "the users page"],
  [/^\/admin\/costs$/, "the costs page"],
  [/^\/admin\/analytics$/, "the analytics page"],
  [/^\/admin(?:\/|$)/, "the admin area"],
  [/^\/sell\/checkout$/, "checkout"],
  [/^\/sell(?:\/|$)/, "the sell page"],
  [/^\/dealer\/subscribe$/, "dealer subscription signup"],
  [/^\/dealer\/onboarding/, "dealer onboarding"],
  [/^\/dealer\/profile$/, "the dealer profile"],
  [/^\/api\/dealer-profile\/logo$/, "a dealer logo upload"],
  [/^\/api\/media\//, "a listing image"],
  [/^\/listings\//, "a listing"],
  [/^\/dealers\//, "a dealer page"],
  [/^\/search$/, "search"],
  [/^\/pricing$/, "the pricing page"],
  [/^\/sign-up$/, "sign-up"],
  [/^\/privacy$/, "the privacy page"],
  [/^\/$/, "the home page"],
];

function pageLabel(route?: string | null): string {
  const path = (route ?? "").split("?")[0] ?? "";
  if (!path) return "a page";
  for (const [pattern, label] of ROUTE_LABELS) {
    if (pattern.test(path)) return label;
  }
  return "a page";
}

function placeName(environment?: string | null): string {
  const value = (environment ?? "").toLowerCase();
  if (value === "production") return "the live site";
  if (value === "preview" || value === "staging") return "the preview site";
  if (value === "development" || value === "dev") return "the development site";
  return "the site";
}

function happened(occurrences: number): string {
  if (occurrences <= 1) return "It has happened once.";
  return `It has happened ${occurrences} times.`;
}

function checkLine(check: string): string {
  if (check === "it") return "Please open this and take a look";
  return `Please open this and check ${check}`;
}

function unknownMatch(page: string): PlainAlertMatch {
  const where = page === "a page" ? "the site" : page;
  return {
    problem: "Something needs attention",
    summary: `Someone ran into a problem on ${where}.`,
    check: "it",
  };
}

function alertLines(title: string, message: string): string[] {
  return `${title}\n${message}`
    .replace(/__TURBOPACK__imported__module__\S+?\["db"\]\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\(\)/g, "prisma.$1.$2()")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

export function explainMonitoringAlert(input: PlainMonitoringAlertInput): PlainMonitoringAlert {
  const lines = alertLines(input.title, input.message);
  const page = pageLabel(input.route);
  const match = matchPlainAlert({
    text: lines.join("\n"),
    title: input.title.replace(/\s+/g, " ").trim(),
    message: input.message.replace(/\s+/g, " ").trim(),
    lines,
    action: input.action ?? "",
    page,
  }) ?? unknownMatch(page);
  const place = placeName(input.environment);
  const subject = match.subject ?? (
    match.detail ? `${match.problem} on ${place} — ${match.detail}` : `${match.problem} on ${place}`
  );
  const sentences = input.omitCount ? [match.summary] : [match.summary, happened(input.occurrences ?? 1)];
  if (input.severity === "CRITICAL") sentences.push("This needs attention now.");
  else if (match.impact) sentences.push(match.impact);
  return {
    subject: subject.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 300),
    summary: sentences.join(" "),
    check: checkLine(match.check),
  };
}
