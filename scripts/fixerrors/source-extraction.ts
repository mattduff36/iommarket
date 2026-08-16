import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { SnapshotEvent, SnapshotIssue, SourceFileRef } from "./types";

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
  return `${normalizeSourceFilePath(ref.file)}:${ref.line || ""}`;
}

function addSourceRef(refs: SourceFileRef[], seen: Set<string>, ref: SourceFileRef): void {
  const normalizedRef = { ...ref, file: normalizeSourceFilePath(ref.file) };
  const key = sourceRefKey(normalizedRef);
  if (!seen.has(key)) {
    seen.add(key);
    refs.push(normalizedRef);
  }
}

function collectSourceFiles(repoRoot: string): string[] {
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

function routePathFromAppFile(file: string): string | null {
  const normalized = normalizeSourceFilePath(file);
  const match = normalized.match(/^app\/(.+)\/(?:page|layout|route)\.(?:tsx|ts|jsx|js)$/);
  if (!match) return null;
  const routeSegments = match[1]
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

  const webpackPattern = /webpack-internal:\/\/\/[^)]*?\.\/([^:)]+?)(?::(\d+))?(?::(\d+))?(?:\)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = webpackPattern.exec(stack)) !== null) {
    const file = match[1];
    if (!file || file.includes("node_modules") || file.startsWith("__")) continue;
    addSourceRef(refs, seen, {
      file,
      line: match[2] ? Number.parseInt(match[2], 10) : undefined,
      column: match[3] ? Number.parseInt(match[3], 10) : undefined,
    });
  }

  const directPattern =
    /(?:\/app\/|\.\/)((?:app|lib|components|actions|hooks|utils|services)[^:)]*?)(?::(\d+))?(?::(\d+))?(?:\)|$)/g;
  while ((match = directPattern.exec(stack)) !== null) {
    const lineStart = stack.lastIndexOf("\n", match.index) + 1;
    const lineEndIndex = stack.indexOf("\n", match.index);
    const currentLine = stack.slice(lineStart, lineEndIndex === -1 ? stack.length : lineEndIndex);
    if (currentLine.includes(".next/") || currentLine.includes("_next/")) continue;
    const file = match[1];
    if (!file || file.includes("node_modules")) continue;
    addSourceRef(refs, seen, {
      file,
      line: match[2] ? Number.parseInt(match[2], 10) : undefined,
      column: match[3] ? Number.parseInt(match[3], 10) : undefined,
    });
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
  repoRoot: string,
): SourceFileRef[] {
  const pagePath = getPagePath(route);
  if (!pagePath) return [];
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  for (const file of collectSourceFiles(repoRoot)) {
    if (routePathFromAppFile(file) === pagePath) addSourceRef(refs, seen, { file });
  }
  return refs;
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
): SourceFileRef[] {
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const events: Array<Pick<SnapshotEvent, "stack" | "message" | "route" | "action" | "requestPath" | "component">> = [
    {
      stack: issue.events[0]?.stack ?? null,
      message: issue.sampleMessage,
      route: issue.sampleRoute,
      action: issue.sampleAction,
      requestPath: issue.events[0]?.requestPath ?? issue.sampleRoute,
      component: issue.sampleComponent,
    },
    ...issue.events,
  ];

  for (const event of events) {
    const searchText = [event.stack ?? "", event.message, event.route ?? "", event.requestPath ?? ""].join("\n");
    for (const ref of parseStackTrace(event.stack)) addSourceRef(refs, seen, ref);
    if (refs.length === 0) {
      for (const ref of extractNextAppChunkSourceRefs(searchText, repoRoot)) addSourceRef(refs, seen, ref);
    }
    if (refs.length === 0) {
      for (const ref of extractNextServerAppSourceRefs(searchText, repoRoot)) addSourceRef(refs, seen, ref);
    }
    if (refs.length === 0) {
      for (const ref of inferFromAction(event.action)) addSourceRef(refs, seen, ref);
    }
    if (refs.length === 0) {
      for (const ref of inferSourceRefsFromRoute(event.route ?? event.requestPath, repoRoot)) {
        addSourceRef(refs, seen, ref);
      }
    }
  }

  return refs;
}
