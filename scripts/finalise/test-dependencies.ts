import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Only these framework/standard-library imports have known input behaviour.
// An unrecognised dependency makes its entire importing suite run again.
const safePackages = new Set(["vitest", "react", "react-dom", "react/jsx-runtime", "@testing-library/react",
  "@testing-library/user-event", "zod", "node:assert", "node:assert/strict", "node:path", "path"]);
const opaqueAccess = /\b(?:require|import)\s*\(|\b(?:eval|Function|fetch|XMLHttpRequest|WebSocket|process|globalThis|Deno|Bun|__dirname|__filename)\b|import\.meta|\b(?:vi|vitest)\s*\.\s*(?:mock|doMock|unmock|doUnmock|importActual|importMock|dynamicImportSettled)\b/u;

export function affectedTestFiles(root: string, suites: string[], changed: string[]): string[] | null {
  if (changed.some(file => !/^(?:(?:app|components|lib|actions)\/.*\.(?:ts|tsx)|__tests__\/.*\.test\.(?:ts|tsx))$/u.test(file) || file.endsWith(".d.ts"))) return null;
  // These reviewed global inputs load no application modules. If their setup or aliases
  // change, static per-file analysis alone cannot establish the global dependency closure.
  const globalFiles = ["vitest.config.ts", "vitest.setup.ts", "vitest.globals-shim.ts", "tsconfig.json"];
  try {
    const globalSources = globalFiles.map(file => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n"));
    if (createHash("sha256").update(JSON.stringify(globalSources)).digest("hex") !==
        "13a6f361a6685fcd0c9d5e51c59854da93e913cd74e948bbc3fd6fc1f161d556") return null;
  } catch { return null; }
  const dirty = new Set(changed);
  const cache = new Map<string, string[] | null>();
  function imports(file: string): string[] | null {
    if (cache.has(file)) return cache.get(file)!;
    const source = readFileSync(path.join(root, file), "utf8");
    const info = ts.preProcessFile(source, true, true);
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const refs = new Set(info.importedFiles.map(ref => ref.fileName));
    // Captures side-effect imports, export-from and non-literal runtime loading.
    if (opaqueAccess.test(source) || info.referencedFiles.length || info.libReferenceDirectives.length || info.typeReferenceDirectives.length ||
        parsed.statements.some(stmt => ts.isImportEqualsDeclaration(stmt))) {
      cache.set(file, null); return null;
    }
    const deps: string[] = [];
    for (const ref of refs) {
      if (safePackages.has(ref)) continue;
      if (!ref.startsWith(".") && !ref.startsWith("@/")) { cache.set(file, null); return null; }
      const stem = ref.startsWith("@/") ? ref.slice(2) : path.posix.join(path.posix.dirname(file), ref);
      const candidates = [stem, stem + ".ts", stem + ".tsx", stem + "/index.ts", stem + "/index.tsx"]
        .filter(candidate => /\.tsx?$/u.test(candidate) && existsSync(path.join(root, candidate)));
      const unsupported = ["", ".js", ".jsx", ".json", ".mjs", "/index.js", "/index.jsx"].some(suffix => {
        const candidate = stem + suffix;
        return !candidates.includes(candidate) && existsSync(path.join(root, candidate)) && !["", "/"].includes(suffix);
      });
      if (stem.startsWith("../") || candidates.length !== 1 || unsupported) { cache.set(file, null); return null; }
      deps.push(candidates[0]);
    }
    cache.set(file, deps);
    return deps;
  }
  try {
    return suites.filter(suite => {
      const stack = [suite];
      const seen = new Set<string>();
      while (stack.length) {
        const file = stack.pop()!;
        if (dirty.has(file)) return true;
        if (seen.has(file)) continue;
        seen.add(file);
        const deps = imports(file);
        if (!deps) return true;
        stack.push(...deps);
      }
      return false;
    });
  } catch { return null; }
}
