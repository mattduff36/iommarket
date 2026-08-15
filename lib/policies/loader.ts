import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POLICY_DEFINITIONS } from "@/lib/policies/registry";
import { POLICY_SLUGS, type PolicyDocument, type PolicySlug } from "@/lib/policies/types";

const POLICY_DIR = join(process.cwd(), "content", "policies");

export function hashPolicyMarkdown(markdown: string) {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

export function loadPolicyMarkdown(slug: PolicySlug) {
  const definition = POLICY_DEFINITIONS[slug];
  return readFileSync(join(POLICY_DIR, definition.fileName), "utf8");
}

export function getPolicyDocument(slug: PolicySlug): PolicyDocument {
  const definition = POLICY_DEFINITIONS[slug];
  const markdown = loadPolicyMarkdown(slug);
  return {
    ...definition,
    markdown,
    contentHash: hashPolicyMarkdown(markdown),
  };
}

export function getAllPolicyDocuments() {
  return POLICY_SLUGS.map((slug) => getPolicyDocument(slug));
}
