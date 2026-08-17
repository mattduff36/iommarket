import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/cost-sync.yml"),
  "utf8",
);

describe("cost sync workflow T3", () => {
  it("sends the documented deployment URL and does not filter on undocumented payload fields", () => {
    expect(workflow).toContain("vercel.deployment.success");
    expect(workflow).toContain("github.event.client_payload.url");
    expect(workflow).toContain("deploymentUrl");
    expect(workflow).toContain("jq -cn");
    expect(workflow).not.toContain("github.event.client_payload.target");
    expect(workflow).not.toContain("github.event.client_payload.projectId");
    expect(workflow).not.toContain("github.event.client_payload.id");
  });
});
