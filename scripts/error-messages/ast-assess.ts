import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

export interface AssessInput {
  file: string;
  line: number;
  source: string;
}

export interface LineAssessment {
  rule_id: string;
  classification: "displayed" | "internal-only" | "irrelevant";
  semantic_display_verified: boolean;
  syntactic_evidence: string;
  journey: string;
  journey_evidence: string;
  reason: string;
  recovery: string;
  severity: "low" | "medium" | "high" | "unknown";
  severity_basis: string;
  exception: string;
  family_id: string;
  trace: string;
}

interface FnInfo {
  key: string;
  file: string;
  name: string;
  node: ts.FunctionLikeDeclaration;
  sf: ts.SourceFile;
}

export interface ProjectIndex {
  files: Map<string, ts.SourceFile>;
  fnByKey: Map<string, FnInfo>;
  exportKey: Map<string, string>;
  forwarded: Set<string>;
  rendersMessage: Map<string, boolean>;
}

const ROOTS = ["actions", "app", "components", "lib"];

function isImplementedFunction(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)) && Boolean(node.body);
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "private") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

function listSources(root: string): string[] {
  const files: string[] = [];
  for (const folder of ROOTS) {
    const dir = join(root, folder);
    try {
      if (statSync(dir).isDirectory()) walk(dir, files);
    } catch {
      // Optional folder.
    }
  }
  return files;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function calleeText(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeText(expr.expression);
    return left ? `${left}.${expr.name.text}` : expr.name.text;
  }
  return "";
}

function functionLabel(node: ts.FunctionLikeDeclaration, sf: ts.SourceFile): string {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  if (node.name && ts.isIdentifier(node.name)) return `${node.name.text}@${line}`;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return `${parent.name.text}@${line}`;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && ts.isIdentifier(parent.name)) {
    return `${parent.name.text}@${line}`;
  }
  return `anonymous@${line}`;
}

function propName(node: ts.Node): string {
  if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isShorthandPropertyAssignment(node)) && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return "";
}

function resolveModule(spec: string, from: string, known: Set<string>): string | null {
  let base = "";
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else return null;
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const key = `${base}${suffix}`;
    if (known.has(key)) return key;
  }
  return null;
}

function isDiagnosticCallee(name: string): boolean {
  return /^(console\.(error|warn|log|info|debug)|captureException|captureBusinessEvent|reportHandledException|reportClientException|logMonitoringFallback|logger\.)/.test(name)
    || name.startsWith("redact");
}

function isPublicSinkCallee(name: string): boolean {
  return name === "setError"
    || name.endsWith(".setError")
    || name === "setFormError"
    || name === "toast"
    || name.startsWith("toast.")
    || name === "NextResponse.json"
    || name === "Response.json"
    || name === "publicErrorBody"
    || name === "publicFieldErrorBody"
    || name === "publicAuthErrorMessage"
    || name === "splitActionError";
}

function objectHasPublicField(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some((prop) => {
    const name = propName(prop);
    return name === "error" || name === "fieldErrors" || name === "formError" || name === "message";
  });
}

function isPublicExpr(expr: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(expr)) return objectHasPublicField(expr);
  if (ts.isCallExpression(expr)) return isPublicSinkCallee(calleeText(expr.expression));
  return false;
}

function forwardsError(node: ts.Node, binding: string | null): boolean {
  let found = false;
  const walk = (current: ts.Node) => {
    if (found) return;
    if (ts.isThrowStatement(current)) found = true;
    if (binding && ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === binding && current.name.text === "message") {
      found = true;
    }
    if (binding && ts.isIdentifier(current) && current.text === binding) {
      const parent = current.parent;
      if (parent && (ts.isReturnStatement(parent) || ts.isJsxExpression(parent) || (ts.isPropertyAssignment(parent) && propName(parent) === "error"))) {
        found = true;
      }
    }
    current.forEachChild(walk);
  };
  walk(node);
  return found;
}

function collectImports(sf: ts.SourceFile, file: string, known: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !node.importClause) return;
    const resolved = resolveModule(node.moduleSpecifier.text, file, known);
    if (!resolved) return;
    const clause = node.importClause;
    if (clause.name) map.set(clause.name.text, `${resolved}#default`);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) map.set(named.name.text, `${resolved}#*`);
    if (named && ts.isNamedImports(named)) {
      for (const spec of named.elements) {
        const imported = spec.propertyName?.text ?? spec.name.text;
        map.set(spec.name.text, `${resolved}#${imported}`);
      }
    }
  });
  return map;
}

function callsOf(node: ts.Node, imports: Map<string, string>, local: Map<string, string>, exportKey: Map<string, string>): string[] {
  const found: string[] = [];
  const walk = (current: ts.Node) => {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (ts.isCallExpression(current)) {
      const expr = current.expression;
      if (ts.isIdentifier(expr)) {
        const imported = imports.get(expr.text);
        const localKey = local.get(expr.text);
        if (imported) found.push(exportKey.get(imported) ?? imported);
        else if (localKey) found.push(localKey);
      } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
        const binding = imports.get(expr.expression.text);
        if (binding?.endsWith("#*")) {
          const target = `${binding.slice(0, -2)}#${expr.name.text}`;
          found.push(exportKey.get(target) ?? target);
        }
      }
    }
    current.forEachChild(walk);
  };
  walk(node);
  return found;
}

export function buildProjectIndex(root: string): ProjectIndex {
  const paths = listSources(root);
  const files = new Map<string, ts.SourceFile>();
  for (const full of paths) {
    const rel = relative(root, full).replaceAll("\\", "/");
    const text = readFileSync(full, "utf8");
    files.set(rel, ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel)));
  }
  const known = new Set(files.keys());
  const fnByKey = new Map<string, FnInfo>();
  const exportKey = new Map<string, string>();
  const localNames = new Map<string, Map<string, string>>();
  for (const [file, sf] of files) {
    const local = new Map<string, string>();
    const visit = (node: ts.Node) => {
      if (isImplementedFunction(node)) {
        const name = functionLabel(node, sf);
        const key = `${file}#${name}`;
        const info: FnInfo = { key, file, name: name.split("@")[0] ?? name, node, sf };
        fnByKey.set(key, info);
        if (!local.has(info.name)) local.set(info.name, key);
        exportKey.set(`${file}#${info.name}`, key);
        if (info.name !== "default") exportKey.set(`${file}#default`, exportKey.get(`${file}#default`) ?? key);
      }
      node.forEachChild(visit);
    };
    visit(sf);
    localNames.set(file, local);
  }
  const forwarded = new Set<string>();
  for (const info of fnByKey.values()) {
    const imports = collectImports(info.sf, info.file, known);
    const local = localNames.get(info.file) ?? new Map<string, string>();
    const walk = (node: ts.Node) => {
      if (node !== info.node && ts.isFunctionLike(node)) return;
      if (ts.isTryStatement(node) && node.catchClause) {
        const binding = node.catchClause.variableDeclaration && ts.isIdentifier(node.catchClause.variableDeclaration.name)
          ? node.catchClause.variableDeclaration.name.text
          : null;
        if (forwardsError(node.catchClause.block, binding)) {
          for (const callee of callsOf(node.tryBlock, imports, local, exportKey)) forwarded.add(callee);
        }
      }
      node.forEachChild(walk);
    };
    walk(info.node);
  }
  return { files, fnByKey, exportKey, forwarded, rendersMessage: new Map() };
}

function descendantPublicReturn(node: ts.Node): ts.ReturnStatement | null {
  let found: ts.ReturnStatement | null = null;
  const walk = (current: ts.Node) => {
    if (found) return;
    if (current !== node && ts.isFunctionLike(current)) return;
    if (current !== node && ts.isReturnStatement(current) && current.expression && isPublicExpr(current.expression)) {
      found = current;
      return;
    }
    current.forEachChild(walk);
  };
  walk(node);
  return found;
}

function namesPublishedBy(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  const walk = (current: ts.Node) => {
    if (current !== fn && ts.isFunctionLike(current)) return;
    if (ts.isReturnStatement(current) && current.expression && ts.isObjectLiteralExpression(current.expression)) {
      for (const prop of current.expression.properties) {
        const name = propName(prop);
        if (!["error", "message", "formError"].includes(name)) continue;
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) names.add(prop.initializer.text);
        if (ts.isShorthandPropertyAssignment(prop) && ts.isIdentifier(prop.name)) names.add(prop.name.text);
      }
    }
    current.forEachChild(walk);
  };
  walk(fn);
  return names;
}
function fileRendersMessage(index: ProjectIndex, file: string): boolean {
  const cached = index.rendersMessage.get(file);
  if (cached !== undefined) return cached;
  const sf = index.files.get(file);
  if (!sf) return false;
  let found = false;
  const walk = (node: ts.Node) => {
    if (found) return;
    if (ts.isJsxText(node) && node.getText(sf).trim().length > 0) found = true;
    if (ts.isJsxExpression(node)) found = true;
    if (ts.isCallExpression(node) && isPublicSinkCallee(calleeText(node.expression))) found = true;
    node.forEachChild(walk);
  };
  walk(sf);
  index.rendersMessage.set(file, found);
  return found;
}

function journeyFor(file: string): { journey: string; journey_evidence: string } {
  const rules: Array<[RegExp, string]> = [
    [/^app\/api\/listing-images\/|^components\/marketplace\/image-upload\.tsx$|^lib\/(images|media|upload)\//, "listing-photo-upload"],
    [/^actions\/listings|^lib\/listings\/|^components\/listings\/|\/sell\/|create-listing/, "listing-save"],
    [/payment|checkout|subscribe|sample-checkout/, "payments"],
    [/error\.tsx$|global-error|error-fallback/, "page-boundary"],
    [/^actions\/admin|^app\/\(admin\)|^components\/admin|^lib\/admin\/|dealer/, "dealer-admin"],
    [/account|auth|sign-in|sign-up|password|waitlist|early-access/, "accounts"],
    [/enquir|contact/, "enquiries"],
    [/saved-search|saved-listing|user-tools|watchlist/, "saved-listings"],
    [/vehicle/, "vehicle-lookup"],
    [/report|download|retention/, "reports"],
    [/moderat/, "moderation"],
    [/^lib\/monitoring\//, "monitoring"],
    [/^lib\/(costs|database-sync|ops|preview-packs|deployment|db|supabase|config|privacy|seo|analytics|email|faq|formatting|utils)\b|^lib\/navigation-paths\.ts$/, "internal-platform"],
    [/^lib\/(forms|rate-limit|validations|policy)\b/, "shared-error-contract"],
  ];
  for (const [pattern, journey] of rules) {
    if (pattern.test(file)) return { journey, journey_evidence: "module-and-enclosing-function" };
  }
  const parts = file.split("/");
  if (parts[0] === "app" && parts[1] === "api") return { journey: `api-${parts[2] ?? "root"}`, journey_evidence: "route-directory" };
  if (parts[0] === "app") return { journey: `page-${parts[2] ?? parts[1] ?? "app"}`, journey_evidence: "page-directory" };
  if (parts[0] === "actions") return { journey: `action-${(parts[1] ?? "action").replace(/\.tsx?$/, "")}`, journey_evidence: "action-module" };
  if (parts[0] === "components") return { journey: `ui-${parts[1] ?? "component"}`, journey_evidence: "component-directory" };
  if (parts[0] === "lib") return { journey: `lib-${(parts[1] ?? "lib").replace(/\.tsx?$/, "")}`, journey_evidence: "library-module" };
  return { journey: `module-${parts[0] ?? "root"}`, journey_evidence: "path-owner" };
}

function familyFor(source: string, ruleId: string): string {
  if (ruleId.includes("diagnostic") || /console\.|captureException|logMonitoring/.test(source)) return "monitoring";
  if (/fieldErrors|flatten\(/.test(source)) return "field-errors";
  if (/\.message|instanceof Error/.test(source)) return "raw-message";
  if (/rateLimit|Retry-After|429|Too many/.test(source)) return "rate-limit";
  if (/error\.tsx|global-error|error-fallback/.test(source)) return "error-boundary";
  if (ruleId.includes("jsx") || ruleId.includes("return") || ruleId.includes("http") || ruleId.includes("sink")) return "public-sink";
  if (/throw\b/.test(source)) return "thrown";
  if (/["'`][^"'`]{8,}["'`]/.test(source)) return "static-literal";
  return "fragment";
}

function blank(file: string, ruleId: string, classification: LineAssessment["classification"], evidence: string, reason: string, extra: Partial<LineAssessment> = {}): LineAssessment {
  const journey = journeyFor(file);
  const severity = extra.severity ?? (classification === "displayed" ? "medium" : "low");
  return {
    rule_id: ruleId,
    classification,
    semantic_display_verified: extra.semantic_display_verified ?? false,
    syntactic_evidence: evidence,
    journey: journey.journey,
    journey_evidence: journey.journey_evidence,
    reason,
    recovery: extra.recovery ?? (classification === "displayed"
      ? "Show the approved sentence for this journey when it is migrated."
      : "No user recovery on this line."),
    severity,
    severity_basis: extra.severity_basis ?? ruleId,
    exception: extra.exception ?? "",
    family_id: extra.family_id ?? "fragment",
    trace: extra.trace ?? "",
  };
}

function ancestors(node: ts.Node): ts.Node[] {
  const list: ts.Node[] = [];
  let current: ts.Node | undefined = node;
  while (current) {
    list.push(current);
    current = current.parent;
  }
  return list;
}

function innermost(sf: ts.SourceFile, pos: number): ts.Node {
  let best: ts.Node = sf;
  const walk = (node: ts.Node) => {
    const start = node.getStart(sf);
    if (start > pos || node.end < pos) return;
    best = node;
    node.forEachChild(walk);
  };
  walk(sf);
  return best;
}

function locate(sf: ts.SourceFile, line: number, source: string): { node: ts.Node; note: string } {
  const needle = source.trim();
  let matchedLine = line;
  let note = `AST node at ${sf.fileName}:${line}`;
  if (line < 1 || line > sf.getLineStarts().length) matchedLine = 1;
  const lineStart = sf.getPositionOfLineAndCharacter(Math.min(matchedLine, sf.getLineStarts().length) - 1, 0);
  const next = matchedLine < sf.getLineStarts().length ? sf.getPositionOfLineAndCharacter(matchedLine, 0) : sf.end;
  const lineText = sf.text.slice(lineStart, next);
  if (needle && !lineText.includes(needle.slice(0, Math.min(needle.length, 80)))) {
    const found = needle ? sf.text.indexOf(needle) : -1;
    if (found >= 0) {
      matchedLine = sf.getLineAndCharacterOfPosition(found).line + 1;
      note = `recorded line ${line} drifted; snippet matched ${sf.fileName}:${matchedLine}`;
      return { node: innermost(sf, found), note };
    }
    note = `recorded line ${line} does not contain the snippet`;
  }
  const at = lineText.indexOf(needle.slice(0, Math.min(needle.length, 80)));
  return { node: innermost(sf, lineStart + Math.max(at, 0)), note };
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  return ancestors(node).find((item): item is ts.FunctionLikeDeclaration => isImplementedFunction(item)) ?? null;
}

function uploadTrace(file: string): string {
  if (!/^app\/api\/listing-images\/|^components\/marketplace\/image-upload\.tsx$|^lib\/(images\/(client-upload|imagekit-client-upload|upload-client-error)|media\/(upload-error-catalog|verification-error|managed-upload|managed-io|strip-metadata))/.test(file)) {
    return "";
  }
  return "static: classifyUploadError/publicErrorBody -> app/api/listing-images response -> uploadErrorFromPayload -> presentClientUploadError -> components/marketplace/image-upload.tsx setError";
}

export function assessCandidate(row: AssessInput, index: ProjectIndex | null): LineAssessment {
  const journey = journeyFor(row.file);
  const sf = index?.files.get(row.file) ?? ts.createSourceFile(row.file, row.source, ts.ScriptTarget.Latest, true, scriptKind(row.file));
  const located = index?.files.has(row.file) ? locate(sf, row.line, row.source) : { node: innermost(sf, 0), note: "snippet parse" };
  const node = located.node;
  const chain = ancestors(node);
  const fn = enclosingFunction(node);
  const fnLabel = fn ? functionLabel(fn, sf) : "module";
  const fnKey = `${row.file}#${fnLabel}`;
  const trace = uploadTrace(row.file);
  const baseFamily = familyFor(row.source, "");

  const finish = (assessment: LineAssessment): LineAssessment => ({
    ...assessment,
    journey: journey.journey,
    journey_evidence: `${journey.journey_evidence}; ${fnLabel}`,
    family_id: assessment.family_id === "fragment" ? baseFamily : assessment.family_id,
    syntactic_evidence: `${located.note}. ${assessment.syntactic_evidence}`,
    trace: assessment.trace || (assessment.classification === "displayed" ? trace : ""),
    semantic_display_verified: assessment.semantic_display_verified && assessment.classification === "displayed",
  });

  if (chain.some((item) => ts.isImportDeclaration(item) || ts.isInterfaceDeclaration(item) || ts.isTypeAliasDeclaration(item) || ts.isTypeLiteralNode(item) || ts.isEnumDeclaration(item) || ts.isImportTypeNode(item))) {
    return finish(blank(row.file, "ast-type-or-import", "irrelevant", "node is an import, interface, or type", "The candidate is a type or import, not a runtime message."));
  }
  if (ts.isJsxClosingElement(node) || chain.some((item) => ts.isJsxClosingElement(item))) {
    return finish(blank(row.file, "ast-jsx-close", "irrelevant", "JSX closing element", "A closing tag is not a message."));
  }
  const signature = chain.find((item) => ts.isFunctionLike(item) || ts.isClassDeclaration(item));
  if (signature && sf.getLineAndCharacterOfPosition(signature.getStart(sf)).line + 1 === row.line && (!isImplementedFunction(signature) || sf.getLineAndCharacterOfPosition(signature.body.getStart(sf)).line + 1 > row.line)) {
    return finish(blank(row.file, "ast-signature", "irrelevant", `signature line of ${fnLabel}`, "The candidate is a function or class signature, not a message."));
  }
  if (chain.some((item) => ts.isParameter(item) || ts.isPropertyDeclaration(item) || ts.isMethodSignature(item))) {
    return finish(blank(row.file, "ast-binding", "irrelevant", "parameter or type property", "The candidate declares a binding. It does not produce message text."));
  }

  const call = chain.find((item): item is ts.CallExpression => ts.isCallExpression(item));
  if (call && isDiagnosticCallee(calleeText(call.expression)) && call.expression !== node && !chain.some((item) => item === call.expression)) {
    return finish(blank(row.file, "ast-diagnostic-call", "internal-only", `argument of ${calleeText(call.expression)} in ${fnLabel}`, "This expression is a log or monitoring argument.", { family_id: "monitoring" }));
  }

  const inCondition = chain.some((item) => ts.isIfStatement(item)
    && node.getStart(sf) >= item.expression.getStart(sf)
    && node.end <= item.expression.end);
  if (inCondition && !chain.some((item) => ts.isReturnStatement(item) || ts.isThrowStatement(item))) {
    return finish(blank(row.file, "ast-branch-condition", "internal-only", `condition in ${fnLabel}`, "The expression chooses a branch. It is not the rendered message."));
  }

  const returned = chain.find((item): item is ts.ReturnStatement => ts.isReturnStatement(item));
  if (returned?.expression && (isPublicExpr(returned.expression) || chain.some((item) => ts.isPropertyAssignment(item) && ["error", "message", "formError", "fieldErrors"].includes(propName(item))))) {
    const rendered = index ? fileRendersMessage(index, row.file) : false;
    return finish(blank(row.file, "ast-public-return", "displayed", `return in ${fnLabel}`, "The enclosing return carries a public error or message field.", {
      semantic_display_verified: rendered || Boolean(trace),
      severity: /\.message/.test(row.source) ? "high" : "medium",
      severity_basis: /\.message/.test(row.source) ? "raw-message-at-public-return" : "public-return",
      family_id: "public-sink",
      trace: trace || (rendered ? `static: ${row.file} renders a message or error sink in the same file as ${fnLabel}` : ""),
      recovery: "Keep field errors on the field. Do not tell the user to correct valid input after an infrastructure failure.",
    }));
  }

  const nestedReturn = descendantPublicReturn(node);
  if (nestedReturn) {
    return finish(blank(row.file, "ast-public-return", "displayed", `statement in ${fnLabel} contains a public error return`, "The candidate statement returns a public error or message field.", {
      semantic_display_verified: index ? fileRendersMessage(index, row.file) : false,
      severity: /\.message/.test(row.source) ? "high" : "medium",
      severity_basis: /\.message/.test(row.source) ? "raw-message-at-public-return" : "public-return",
      family_id: "public-sink",
      trace,
      recovery: "Keep field errors on the field. Do not tell the user to correct valid input after an infrastructure failure.",
    }));
  }

  const declaration = chain.find((item): item is ts.VariableDeclaration => ts.isVariableDeclaration(item));
  if (fn && declaration && ts.isIdentifier(declaration.name) && namesPublishedBy(fn).has(declaration.name.text)) {
    return finish(blank(row.file, "ast-value-reaches-return", "displayed", `${declaration.name.text} is returned as an error or message from ${fnLabel}`, "This value is published by a later return in the same function.", {
      severity: /\.message/.test(row.source) ? "high" : "medium",
      severity_basis: /\.message/.test(row.source) ? "raw-message-at-public-return" : "value-reaches-public-return",
      family_id: /\.message/.test(row.source) ? "raw-message" : "public-sink",
      semantic_display_verified: false,
      exception: `static-limit: display is the return of ${declaration.name.text} in ${fnKey}, not this assignment`,
    }));
  }
  if (call && isPublicSinkCallee(calleeText(call.expression))) {
    const name = calleeText(call.expression);
    const clearing = node.getText(sf).trim() === "null" || node.getText(sf).trim() === "undefined";
    if (clearing) {
      return finish(blank(row.file, "ast-clears-error", "irrelevant", `${name} clears state in ${fnLabel}`, "This call clears an error. It does not set message text."));
    }
    return finish(blank(row.file, "ast-public-sink", "displayed", `call ${name} in ${fnLabel}`, "The expression is an argument of a public error sink.", {
      semantic_display_verified: true,
      family_id: "public-sink",
      trace: trace || `static: ${row.file}:${fnLabel} calls ${name}`,
      recovery: "Render the approved sentence in the existing alert, summary, or field error.",
    }));
  }

  if (chain.some((item) => ts.isJsxElement(item) || ts.isJsxSelfClosingElement(item) || ts.isJsxExpression(item) || ts.isJsxText(item))) {
    const attr = chain.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item));
    const attrName = attr?.name.getText(sf) ?? "";
    if (["className", "href", "src", "id", "htmlFor", "key", "type", "name", "data-testid"].includes(attrName)) {
      return finish(blank(row.file, "ast-non-message-attribute", "irrelevant", `JSX attribute ${attrName}`, "This attribute is not error copy."));
    }
    return finish(blank(row.file, "ast-jsx-consumer", "displayed", `JSX in ${fnLabel}`, "The expression is in rendered JSX.", {
      semantic_display_verified: true,
      family_id: "public-sink",
      trace: trace || `static: JSX in ${row.file}:${fnLabel}`,
    }));
  }

  if (call && /\.(min|max|regex|refine|email|url|nonempty|length|gt|gte|lt|lte)$/.test(calleeText(call.expression))) {
    return finish(blank(row.file, "ast-schema-message", "displayed", `schema helper ${calleeText(call.expression)} in ${fnLabel}`, "A schema message becomes a field error when validation fails.", {
      semantic_display_verified: false,
      family_id: "field-errors",
      exception: "static-limit: schema message display depends on the caller rendering fieldErrors",
      recovery: "Show the message on the matching field.",
    }));
  }

  const thrown = chain.find((item): item is ts.ThrowStatement => ts.isThrowStatement(item));
  if (thrown) {
    const tryStmt = chain.find((item): item is ts.TryStatement => ts.isTryStatement(item) && item.tryBlock.end >= (thrown.getStart(sf)) && item.tryBlock.getStart(sf) <= thrown.getStart(sf));
    if (tryStmt?.catchClause) {
      const binding = tryStmt.catchClause.variableDeclaration && ts.isIdentifier(tryStmt.catchClause.variableDeclaration.name)
        ? tryStmt.catchClause.variableDeclaration.name.text
        : null;
      if (forwardsError(tryStmt.catchClause.block, binding)) {
        return finish(blank(row.file, "ast-throw-forwarded", "displayed", `throw in ${fnLabel} is forwarded by the local catch`, "The catch returns or rethrows the error message.", {
          severity: "high",
          severity_basis: "catch-returns-message",
          family_id: "raw-message",
          semantic_display_verified: Boolean(trace),
          trace,
        }));
      }
      return finish(blank(row.file, "ast-throw-replaced", "internal-only", `throw in ${fnLabel} is replaced by the local catch`, "The catch does not return this message."));
    }
    const callerForwards = index?.forwarded.has(fnKey) || index?.forwarded.has(`${row.file}#${fnLabel.split("@")[0]}`);
    if (callerForwards) {
      return finish(blank(row.file, "ast-throw-caller-sink", "displayed", `throw in ${fnLabel}; a caller or this function has a public error sink`, "Static call boundary reaches a public return, JSX, or forwarding catch.", {
        severity: "high",
        severity_basis: "caller-public-sink",
        family_id: "thrown",
        semantic_display_verified: Boolean(trace),
        exception: trace ? "" : `static-limit: caller sink for ${fnKey} is not a runtime render`,
        trace,
      }));
    }
    return finish(blank(row.file, "ast-throw-unrendered", "internal-only", `throw in ${fnKey} has no catch that returns the message`, "No indexed public sink returns this thrown text. Production error boundaries do not render Error.message.", {
      exception: `static-limit: no forwarding catch for ${fnKey}`,
      family_id: "thrown",
    }));
  }

  if (fn && index?.forwarded.has(fnKey) && /error|message|invalid|fail|unauthor/i.test(row.source)) {
    return finish(blank(row.file, "ast-enclosing-public-function", "displayed", `expression inside public function ${fnLabel}`, "The enclosing function returns or renders an error, but this line is not itself the sink.", {
      exception: `static-limit: ${fnKey} is a public function; this fragment was not a direct sink`,
      semantic_display_verified: false,
    }));
  }

  if (/console\.(error|warn|log|info|debug)|captureException|logMonitoringFallback/.test(row.source)) {
    return finish(blank(row.file, "ast-diagnostic-text", "internal-only", "source text is a diagnostic call", "The candidate text is logging or monitoring.", { family_id: "monitoring" }));
  }

  return finish(blank(row.file, "ast-no-public-sink", "internal-only", `no public sink around ${fnLabel} (${ts.SyntaxKind[node.kind]})`, "The AST around this line has no return, JSX, schema, or forwarding catch that publishes it.", {
    family_id: baseFamily,
  }));
}
