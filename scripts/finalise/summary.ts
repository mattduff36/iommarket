import type { FinaliseChangedFile, FinaliseChangeSummary } from "./types";

const SECRET_PATH = /(^|\/)\.env(\.|$)|(^|\/)\.cursor\/mcp\.json$|\.pem$|credentials\.json$/i;
const SCHEMA_PATH = /(^|\/)(prisma\/schema\.prisma|prisma\/migrations\/|supabase\/migrations\/)/i;

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

export function isSecretPath(filePath: string) {
  return SECRET_PATH.test(normalizePath(filePath));
}

export function isSchemaPath(filePath: string) {
  return SCHEMA_PATH.test(normalizePath(filePath));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function joinAreas(areas: string[]) {
  if (areas.length === 0) return "repository files";
  if (areas.length === 1) return areas[0];
  if (areas.length === 2) return `${areas[0]} and ${areas[1]}`;
  return `${areas.slice(0, -1).join(", ")}, and ${areas[areas.length - 1]}`;
}

function commitType(files: string[]): "chore" | "docs" | "feat" | "fix" | "test" {
  if (files.length === 0) return "chore";
  if (files.every((file) => file.includes("__tests__") || file.endsWith(".test.ts") || file.endsWith(".test.tsx"))) {
    return "test";
  }
  if (files.every((file) => file.endsWith(".md"))) return "docs";
  if (files.some((file) => /(^|\/)(fix|bugfix)\//i.test(file))) return "fix";
  if (files.some((file) => file.startsWith("app/") || file.startsWith("components/") || file.startsWith("lib/") || file.startsWith("scripts/") || file.startsWith("prisma/"))) {
    return "feat";
  }
  return "chore";
}

export function summarizeFinaliseChanges(changedFiles: Array<string | FinaliseChangedFile>): FinaliseChangeSummary {
  const files = changedFiles
    .map((entry) => normalizePath(typeof entry === "string" ? entry : entry.path))
    .filter(Boolean);
  const areas = unique(
    files.map((file) => {
      const top = file.includes("/") ? (file.split("/")[0] ?? "repo") : file.replace(/\.[^.]+$/u, "");
      return top.replace(/[^a-z0-9._-]/gi, "-").toLowerCase() || "repo";
    }),
  );
  return {
    commitMessage: `${commitType(files)}: update ${joinAreas(areas)}`,
    fileCount: files.length,
    areas,
    schemaFiles: files.filter(isSchemaPath),
    secretFiles: files.filter(isSecretPath),
  };
}
