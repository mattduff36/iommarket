import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { ZipArchive } from "archiver";
import {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from "docx";
import JSZip from "jszip";
import PDFDocument from "pdfkit";

type MarkdownBlock =
  | { kind: "blank" | "page-break"; text: "" }
  | { kind: "heading"; text: string; level: 1 | 2 | 3 | 4 }
  | { kind: "bullet" | "code" | "quote" | "text"; text: string };

export interface DmPolicyBinaryArtifacts {
  docxPath: string;
  pdfPath: string;
  zipPath: string;
}

const SOURCE_ARTIFACTS = [
  "change-schedule.md",
  "dm-policy-pack.md",
  "index.json",
  "index.md",
  "moderation-matrix.md",
  "redline.md",
  "vehicle-source-register.md",
] as const;

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replaceAll("**", "")
    .replaceAll("__", "")
    .replaceAll("`", "")
    .replaceAll("\\|", "|")
    .trimEnd();
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let inCodeFence = false;

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trimStart().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      blocks.push({ kind: "code", text: line });
      continue;
    }
    if (!line.trim()) {
      if (blocks.at(-1)?.kind !== "blank") {
        blocks.push({ kind: "blank", text: "" });
      }
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ kind: "page-break", text: "" });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: cleanInlineMarkdown(heading[2]),
      });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "bullet", text: cleanInlineMarkdown(bullet[1]) });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ kind: "quote", text: cleanInlineMarkdown(quote[1]) });
      continue;
    }
    blocks.push({ kind: "text", text: cleanInlineMarkdown(line) });
  }

  return blocks;
}

function headingLevel(level: 1 | 2 | 3 | 4) {
  return {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  }[level];
}

async function normalizeDocx(buffer: Buffer, date: string) {
  const timestamp = new Date(`${date}T12:00:00.000Z`);
  const isoTimestamp = timestamp.toISOString();
  const input = await JSZip.loadAsync(buffer);
  const output = new JSZip();
  const entries = Object.values(input.files)
    .filter((entry) => !entry.dir)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    let content = await entry.async("nodebuffer");
    if (entry.name === "docProps/core.xml") {
      const xml = content
        .toString("utf8")
        .replace(
          /(<dcterms:created\b[^>]*>)[^<]*(<\/dcterms:created>)/g,
          `$1${isoTimestamp}$2`,
        )
        .replace(
          /(<dcterms:modified\b[^>]*>)[^<]*(<\/dcterms:modified>)/g,
          `$1${isoTimestamp}$2`,
        );
      content = Buffer.from(xml, "utf8");
    }
    output.file(entry.name, content, {
      binary: true,
      createFolders: false,
      date: timestamp,
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
  }
  return output.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
}

async function buildDocx(markdown: string, date: string) {
  const children = parseMarkdown(markdown).map((block) => {
    if (block.kind === "page-break") {
      return new Paragraph({ children: [new PageBreak()] });
    }
    if (block.kind === "blank") {
      return new Paragraph({ text: "", spacing: { after: 80 } });
    }
    if (block.kind === "heading") {
      return new Paragraph({
        text: block.text,
        heading: headingLevel(block.level),
        spacing: { before: 180, after: 100 },
      });
    }
    if (block.kind === "bullet") {
      return new Paragraph({
        children: [new TextRun(block.text)],
        bullet: { level: 0 },
        spacing: { after: 60 },
      });
    }
    if (block.kind === "code") {
      return new Paragraph({
        children: [
          new TextRun({
            text: block.text || " ",
            font: "Courier New",
            size: 16,
          }),
        ],
        spacing: { after: 20 },
      });
    }
    return new Paragraph({
      children: [
        new TextRun({
          text: block.text,
          italics: block.kind === "quote",
        }),
      ],
      indent: block.kind === "quote" ? { left: 360 } : undefined,
      spacing: { after: 80 },
    });
  });

  const document = new Document({
    creator: "Code Lab Platforms Limited",
    title: `DM policy pack — ${date}`,
    description: "Private working pack — not legal approval",
    sections: [{ children }],
  });
  return normalizeDocx(await Packer.toBuffer(document), date);
}

function pdfFont(block: MarkdownBlock) {
  if (block.kind === "heading") return "Helvetica-Bold";
  if (block.kind === "code") return "Courier";
  if (block.kind === "quote") return "Helvetica-Oblique";
  return "Helvetica";
}

function pdfFontSize(block: MarkdownBlock) {
  if (block.kind !== "heading") return block.kind === "code" ? 7 : 9;
  return { 1: 18, 2: 14, 3: 12, 4: 10 }[block.level];
}

async function buildPdf(markdown: string, date: string) {
  const timestamp = new Date(`${date}T12:00:00.000Z`);
  const document = new PDFDocument({
    autoFirstPage: true,
    bufferPages: false,
    margins: { top: 54, right: 54, bottom: 54, left: 54 },
    info: {
      Title: `DM policy pack — ${date}`,
      Author: "Code Lab Platforms Limited",
      Subject: "Private working pack — not legal approval",
      CreationDate: timestamp,
      ModDate: timestamp,
    },
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);
  });

  for (const block of parseMarkdown(markdown)) {
    if (block.kind === "page-break") {
      if (document.y > document.page.margins.top + 12) document.addPage();
      continue;
    }
    if (block.kind === "blank") {
      document.moveDown(0.35);
      continue;
    }
    const text = block.kind === "bullet" ? `- ${block.text}` : block.text;
    document
      .font(pdfFont(block))
      .fontSize(pdfFontSize(block))
      .fillColor(block.kind === "quote" ? "#404040" : "#111111")
      .text(text || " ", {
        width:
          document.page.width -
          document.page.margins.left -
          document.page.margins.right,
        indent: block.kind === "quote" ? 18 : 0,
        lineGap: block.kind === "code" ? 1 : 2,
      })
      .moveDown(block.kind === "heading" ? 0.35 : 0.15);
  }
  document.end();
  return completed;
}

async function buildZip(
  outputDirectory: string,
  date: string,
  docxName: string,
  docx: Buffer,
  pdfName: string,
  pdf: Buffer,
) {
  const timestamp = new Date(`${date}T12:00:00.000Z`);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    archive.once("end", () => resolve(Buffer.concat(chunks)));
    archive.once("error", reject);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") reject(error);
    });
  });

  const entries = [
    ...SOURCE_ARTIFACTS.map((name) => ({
      name,
      content: readFileSync(join(outputDirectory, name)),
    })),
    { name: docxName, content: docx },
    { name: pdfName, content: pdf },
  ].sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    archive.append(entry.content, {
      name: entry.name,
      date: timestamp,
      mode: 0o644,
    });
  }
  await archive.finalize();
  return completed;
}

export async function generateDmPolicyBinaryArtifacts(
  outputDirectory: string,
  date: string,
): Promise<DmPolicyBinaryArtifacts> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("The pack date must use YYYY-MM-DD.");
  }
  const markdownPath = join(outputDirectory, "dm-policy-pack.md");
  if (!existsSync(markdownPath)) {
    throw new Error(`Policy pack source not found: ${markdownPath}`);
  }
  const markdown = readFileSync(markdownPath, "utf8");
  const docxPath = join(outputDirectory, `dm-policy-pack-${date}.docx`);
  const pdfPath = join(outputDirectory, `dm-policy-pack-${date}.pdf`);
  const zipPath = join(outputDirectory, `dm-policy-pack-${date}.zip`);

  const docx = await buildDocx(markdown, date);
  const pdf = await buildPdf(markdown, date);
  const zip = await buildZip(
    outputDirectory,
    date,
    basename(docxPath),
    docx,
    basename(pdfPath),
    pdf,
  );
  writeFileSync(docxPath, docx);
  writeFileSync(pdfPath, pdf);
  writeFileSync(zipPath, zip);

  const blockerPath = join(outputDirectory, "TOOLING-BLOCKER.txt");
  if (existsSync(blockerPath)) rmSync(blockerPath);
  return { docxPath, pdfPath, zipPath };
}
