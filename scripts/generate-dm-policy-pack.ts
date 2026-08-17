import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getAllPolicyDocuments } from "../lib/policies/loader";
import {
  MODERATION_SUB_REASONS,
  MODERATION_TAXONOMY_VERSION,
} from "../lib/listings/moderation-reasons";
import { generateDmPolicyBinaryArtifacts } from "./dm-policy-pack-binaries";

interface GeneratePackOptions {
  date: string;
  outputDirectory?: string;
  convert?: boolean;
}

interface GeneratedPack {
  outputDirectory: string;
  files: string[];
  conversion: {
    engine: "node" | "skipped";
    docx: "generated" | "skipped";
    pdf: "generated" | "skipped";
    zip: "generated" | "skipped";
  };
}

function assertDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("The pack date must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("The pack date is invalid.");
  }
}

function readPreviousPolicy(relativePath: string) {
  const result = spawnSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.replace(/\r\n/g, "\n") : "";
}

function lineRedline(before: string, after: string) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const matrix = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      matrix[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? matrix[oldIndex + 1][newIndex + 1] + 1
          : Math.max(
              matrix[oldIndex + 1][newIndex],
              matrix[oldIndex][newIndex + 1],
            );
    }
  }

  const output: string[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      output.push(`  ${oldLines[oldIndex]}`);
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex >= oldLines.length ||
        matrix[oldIndex][newIndex + 1] >=
          matrix[oldIndex + 1][newIndex])
    ) {
      output.push(`+ ${newLines[newIndex]}`);
      newIndex += 1;
    } else {
      output.push(`- ${oldLines[oldIndex]}`);
      oldIndex += 1;
    }
  }
  return output.join("\n");
}

function writeArtifact(
  outputDirectory: string,
  fileName: string,
  content: string,
  files: string[],
) {
  const path = join(outputDirectory, fileName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.replace(/\r\n/g, "\n"), "utf8");
  files.push(path);
  return path;
}

function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export async function generateDmPolicyPack(
  options: GeneratePackOptions,
): Promise<GeneratedPack> {
  assertDate(options.date);
  const outputDirectory = resolve(
    options.outputDirectory ??
      join("private", `dm-policy-pack-${options.date}`),
  );
  const files: string[] = [];
  mkdirSync(outputDirectory, { recursive: true });

  const policies = getAllPolicyDocuments();
  const changedPolicies = policies.map((policy) => {
    const path = `content/policies/${policy.fileName}`;
    const previous = readPreviousPolicy(path);
    return {
      ...policy,
      path,
      previous,
      changed: previous !== policy.markdown.replace(/\r\n/g, "\n"),
    };
  });

  const policyIndex = {
    generatedFor: options.date,
    classification: "Private working pack — not legal approval",
    moderationTaxonomyVersion: MODERATION_TAXONOMY_VERSION,
    policies: changedPolicies.map((policy) => ({
      slug: policy.slug,
      title: policy.title,
      route: policy.route,
      version: policy.version,
      effectiveDate: policy.effectiveDate,
      source: policy.path,
      sha256: policy.contentHash,
      changedFromHead: policy.changed,
    })),
  };
  writeArtifact(
    outputDirectory,
    "index.json",
    `${JSON.stringify(policyIndex, null, 2)}\n`,
    files,
  );

  const indexMarkdown = [
    `# DM policy pack index — ${options.date}`,
    "",
    "> Private working pack. Generated deterministically from repository sources. This pack does not claim legal approval.",
    "",
    "| Document | Version | Effective | Source hash | Changed from HEAD |",
    "| --- | --- | --- | --- | --- |",
    ...policyIndex.policies.map(
      (policy) =>
        `| ${escapeTable(policy.title)} | ${policy.version} | ${policy.effectiveDate} | \`${policy.sha256}\` | ${policy.changedFromHead ? "Yes" : "No"} |`,
    ),
    "",
  ].join("\n");
  writeArtifact(outputDirectory, "index.md", indexMarkdown, files);

  const schedule = [
    `# Change schedule — ${options.date}`,
    "",
    "> Operational summary only; not legal advice or approval.",
    "",
    ...changedPolicies.map((policy) => [
      `## ${policy.title}`,
      "",
      `- Version: ${policy.version}`,
      `- Effective: ${policy.effectiveDate}`,
      `- Canonical source: \`${policy.path}\``,
      `- Changed from HEAD: ${policy.changed ? "Yes" : "No"}`,
      `- Current SHA-256: \`${policy.contentHash}\``,
      "",
    ].join("\n")),
  ].join("\n");
  writeArtifact(outputDirectory, "change-schedule.md", schedule, files);

  const redline = [
    `# Policy line redline — ${options.date}`,
    "",
    "Lines beginning `-` are from HEAD; lines beginning `+` are in the current canonical Markdown.",
    "",
    ...changedPolicies
      .filter((policy) => policy.changed)
      .map((policy) => [
        `## ${policy.title}`,
        "",
        "```diff",
        lineRedline(policy.previous, policy.markdown),
        "```",
        "",
      ].join("\n")),
  ].join("\n");
  writeArtifact(outputDirectory, "redline.md", redline, files);

  const moderationMatrix = [
    `# Moderation matrix — taxonomy ${MODERATION_TAXONOMY_VERSION}`,
    "",
    "| Parent | Subreason | Seller label | Clause references | Correction | Resubmit | Appeal | Refund advisory | Retired |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...MODERATION_SUB_REASONS.map(
      (reason) =>
        `| ${reason.parent} | \`${reason.code}\` | ${escapeTable(reason.label)} | ${escapeTable(reason.clauseRefs.join(", "))} | ${escapeTable(reason.correction)} | ${escapeTable(reason.resubmit)} | ${escapeTable(reason.appeal)} | ${escapeTable(reason.refundAdvisory)} | ${reason.retired ? "Yes" : "No"} |`,
    ),
    "",
  ].join("\n");
  writeArtifact(
    outputDirectory,
    "moderation-matrix.md",
    moderationMatrix,
    files,
  );

  const vehicleSources = readFileSync(
    resolve("docs", "dm-pack", "vehicle-sources.md"),
    "utf8",
  );
  writeArtifact(
    outputDirectory,
    "vehicle-source-register.md",
    vehicleSources,
    files,
  );

  const combined = [
    indexMarkdown,
    schedule,
    moderationMatrix,
    vehicleSources,
    ...changedPolicies.map(
      (policy) =>
        `# ${policy.title} — version ${policy.version}\n\n${policy.markdown}`,
    ),
  ].join("\n\n---\n\n");
  writeArtifact(
    outputDirectory,
    "dm-policy-pack.md",
    combined,
    files,
  );

  const conversion: GeneratedPack["conversion"] = {
    engine: "skipped",
    docx: "skipped",
    pdf: "skipped",
    zip: "skipped",
  };
  if (options.convert !== false) {
    try {
      const binaries = await generateDmPolicyBinaryArtifacts(
        outputDirectory,
        options.date,
      );
      files.push(binaries.docxPath, binaries.pdfPath, binaries.zipPath);
      conversion.engine = "node";
      conversion.docx = "generated";
      conversion.pdf = "generated";
      conversion.zip = "generated";
    } catch (error) {
      throw new Error(
        `The DM policy pack source was generated, but binary conversion failed: ${
          error instanceof Error ? error.message : "unknown conversion error"
        }`,
      );
    }
  }

  return { outputDirectory, files, conversion };
}

function parseCliArgs(argv: string[]) {
  const date =
    argv.find((argument) => argument.startsWith("--date="))?.split("=")[1] ??
    new Date().toISOString().slice(0, 10);
  const outputDirectory = argv
    .find((argument) => argument.startsWith("--output="))
    ?.slice("--output=".length);
  return {
    date,
    outputDirectory,
    convert: !argv.includes("--no-convert"),
  };
}

async function main() {
  try {
    const result = await generateDmPolicyPack(
      parseCliArgs(process.argv.slice(2)),
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          outputDirectory: relative(process.cwd(), result.outputDirectory),
          files: result.files.map((file) => relative(process.cwd(), file)),
          conversion: result.conversion,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Pack generation failed"}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("generate-dm-policy-pack.ts")) {
  void main();
}
