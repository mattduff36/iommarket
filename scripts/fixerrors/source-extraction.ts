import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { SnapshotIssue, SourceFileRef } from "./types";

const SOURCE_SEARCH_DIRECTORIES = ["app", "components", "lib", "actions", "hooks", "utils", "services"];
const SOURCE_FILE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const IGNORED_SOURCE_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "private",
  "coverage",
  "dist",
  "build",
]);

function normalizeSourceFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function sourceRefKey(ref: SourceFileRef): string {
  return `${normalizeSourceFilePath(ref.file)}:${ref.line || ""}:${ref.provenance ?? ""}`;
}

function addSourceRef(refs: SourceFileRef[], seen: Set<string>, ref: SourceFileRef): void {
  const normalizedRef = { ...ref, file: normalizeSourceFilePath(ref.file) };
  const key = sourceRefKey(normalizedRef);
  if (!seen.has(key)) {
    seen.add(key);
    refs.push(normalizedRef);
  }
}

export function collectSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (absoluteDirectory: string) => {
    if (!existsSync(absoluteDirectory)) return;
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (IGNORED_SOURCE_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = resolve(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!SOURCE_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
      files.push(normalizeSourceFilePath(relative(repoRoot, absolutePath)));
    }
  };
  for (const directory of SOURCE_SEARCH_DIRECTORIES) {
    walk(resolve(repoRoot, directory));
  }
  return files;
}

export type SourceIndex = ReadonlyMap<string, readonly string[]>;

export function buildSourceIndex(repoRoot = process.cwd(), files = collectSourceFiles(repoRoot)): SourceIndex {
  const index = new Map<string, string[]>();
  for (const file of files) {
    if (isSharedLayoutFile(file)) continue;
    const route = routePathFromAppFile(file);
    if (route !== null) index.set(route, [...(index.get(route) ?? []), file]);
  }
  return index;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findExistingSourceFile(preferredFile: string, repoRoot: string): string | null {
  const normalizedPreferred = normalizeSourceFilePath(preferredFile);
  const extensionless = normalizedPreferred.replace(/\.[^.]+$/, "");
  for (const extension of SOURCE_FILE_EXTENSIONS) {
    const candidate = `${extensionless}${extension}`;
    if (existsSync(resolve(repoRoot, candidate))) return candidate;
  }
  return null;
}

export function isOpaqueScriptError(message: string): boolean {
  return /^script error\.?$/iu.test(message.trim());
}

function isSharedLayoutFile(file: string): boolean {
  return /(?:^|\/)layout\.(?:tsx|ts|jsx|js)$/u.test(normalizeSourceFilePath(file));
}

function routePathFromAppFile(file: string): string | null {
  const normalized = normalizeSourceFilePath(file);
  const match = normalized.match(/^app\/(?:(.+)\/)?(?:page|layout|route)\.(?:tsx|ts|jsx|js)$/);
  if (!match) return null;
  const routeSegments = (match[1] ?? "")
    .split("/")
    .filter((segment) => !segment.startsWith("(") && !segment.startsWith("@"));
  return `/${routeSegments.join("/")}`.replace(/\/+/g, "/") || "/";
}

function getPagePath(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;
  if (pageUrl.startsWith("/")) return pageUrl.split("?")[0] ?? null;
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return null;
  }
}

export function parseStackTrace(stack: string | null): SourceFileRef[] {
  if (!stack) return [];
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();

  const sourcePathPattern = /(?:^|[\\/])((?:app|lib|components|actions|hooks|utils|services)(?:[\\/][^\s:]+)*?\.(?:tsx|ts|jsx|js))(?::(\d+))?(?::(\d+))?/giu;
  for (const frame of stack.split(/\r?\n/u)) {
    if (/[._]next[\\/]|node_modules/.test(frame)) continue;
    sourcePathPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = sourcePathPattern.exec(frame)) !== null) {
      const file = match[1];
      if (!file || file.startsWith("__")) continue;
      addSourceRef(refs, seen, {
        file,
        line: match[2] ? Number.parseInt(match[2], 10) : undefined,
        column: match[3] ? Number.parseInt(match[3], 10) : undefined,
      });
    }
  }

  return refs;
}

function extractNextAppChunkSourceRefs(text: string, repoRoot: string): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const pattern = /\/_next\/static\/chunks\/app\/(.+?)\/(page|layout|route)-[A-Za-z0-9_-]+\.js/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const sourceFile = findExistingSourceFile(
      `app/${safeDecodeURIComponent(match[1] ?? "")}/${match[2]}.tsx`,
      repoRoot,
    );
    if (sourceFile) addSourceRef(refs, seen, { file: sourceFile });
  }
  return refs;
}

function extractNextServerAppSourceRefs(text: string, repoRoot: string): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const pattern = /(?:\/var\/task)?\/\.next\/server\/app\/(.+?)\/(page|layout|route)\.js(?::\d+)?(?::\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const sourceFile = findExistingSourceFile(
      `app/${safeDecodeURIComponent(match[1] ?? "")}/${match[2]}.tsx`,
      repoRoot,
    );
    if (sourceFile) addSourceRef(refs, seen, { file: sourceFile });
  }
  return refs;
}

function inferSourceRefsFromRoute(
  route: string | null | undefined,
  index: SourceIndex,
): SourceFileRef[] {
  const pagePath = getPagePath(route);
  if (!pagePath) return [];
  const matches = index.get(pagePath) ?? [];
  const [onlyMatch] = matches;
  return matches.length === 1 && onlyMatch ? [{ file: onlyMatch }] : [];
}

function inferFromAction(action: string | null | undefined): SourceFileRef[] {
  const candidate = action?.toLowerCase() ?? "";
  if (!candidate) return [];
  if (
    candidate.includes("payforlisting") ||
    candidate.includes("createdealersubscription") ||
    candidate.includes("upgradefeatured")
  ) {
    return [{ file: "actions/payments.ts" }];
  }
  if (
    candidate.includes("createlisting") ||
    candidate.includes("submitlistingforreview") ||
    candidate.includes("renewlisting")
  ) {
    return [{ file: "actions/listings.ts" }];
  }
  if (candidate.includes("moderate") || candidate.includes("admin")) {
    return [{ file: "actions/admin.ts" }];
  }
  return [];
}

export function extractSourceFilesForIssue(
  issue: SnapshotIssue,
  repoRoot = process.cwd(),
  sourceIndex?: SourceIndex,
): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const events = [
    {
      stack: null,
      source: issue.source,
      evidence: undefined,
      message: issue.sampleMessage,
      route: issue.sampleRoute,
      action: issue.sampleAction,
      requestPath: issue.events[0]?.requestPath ?? issue.sampleRoute,
      component: issue.sampleComponent,
    },
    ...issue.events,
  ];

  for (const event of events) {
    const client = issue.source === "CLIENT" || event.source === "CLIENT";
    const stack = !client || event.evidence?.clientStackProvided === true ? event.stack : null;
    const searchText = [stack ?? "", event.message].join("\n");
    for (const ref of parseStackTrace(stack)) {
      addSourceRef(refs, seen, { ...ref, provenance: client ? "client-stack" : "server-stack",
        confidence: typeof ref.line === "number" && Number.isSafeInteger(ref.line) && ref.line > 0 ? "high" : "low" });
    }
    for (const ref of extractNextAppChunkSourceRefs(searchText, repoRoot)) {
      addSourceRef(refs, seen, { ...ref, provenance: "app-chunk", confidence: "low" });
    }
    for (const ref of extractNextServerAppSourceRefs(searchText, repoRoot)) {
      addSourceRef(refs, seen, { ...ref, provenance: "server-chunk", confidence: "low" });
    }
  }
  if (refs.length > 0) return refs;
  for (const ref of inferFromAction(issue.sampleAction)) {
    addSourceRef(refs, seen, { ...ref, provenance: "action", confidence: "low" });
  }
  if (refs.length === 0 && !isOpaqueScriptError(issue.sampleMessage)) {
    for (const ref of inferSourceRefsFromRoute(issue.sampleRoute ?? issue.events[0]?.requestPath, sourceIndex ?? buildSourceIndex(repoRoot))) {
      addSourceRef(refs, seen, { ...ref, provenance: "route", confidence: "low" });
    }
  }
  return refs;
}
