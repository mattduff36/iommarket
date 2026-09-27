import { escapeHtml } from "@/lib/email/client";

export const EMAIL_LOGO_URL = "https://itrader.im/images/logo-itrader-hq.png";

const FONT = "Arial,sans-serif";
const TEXT = "#d7dff2";
const MUTED = "#95a1be";
const BLUE = "#2f86ff";

export interface EmailDetail {
  label: string;
  value: string;
}

export interface BrandedEmailContent {
  title: string;
  intro?: string;
  paragraphs?: string[];
  bodyLines?: string[];
  details?: EmailDetail[];
  highlight?: { title?: string; lines: string[] };
  actionHref?: string;
  actionLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  notice?: string;
  preheader?: string;
  eyebrow?: string;
  align?: "left" | "center";
}

function safeHttpUrl(href: string | undefined) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return href;
  } catch {
    return undefined;
  }
}

function cleanLines(lines: Array<string | undefined>) {
  return lines.filter((line): line is string => Boolean(line && line.trim()));
}

function paragraphHtml(text: string, align: "left" | "center") {
  return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${TEXT};text-align:${align};">${escapeHtml(text)}</p>`;
}

function buttonHtml(href: string, label: string) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">
    <tr>
      <td bgcolor="${BLUE}" style="border-radius:8px;">
        <a href="${safeHref}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:${BLUE};color:#ffffff;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;text-decoration:none;">${safeLabel}</a>
      </td>
    </tr>
  </table>`;
}

export function renderBrandedEmail(input: BrandedEmailContent): { text: string; html: string } {
  const align = input.align ?? "left";
  const actionHref = safeHttpUrl(input.actionHref);
  const secondaryHref = safeHttpUrl(input.secondaryHref);
  const paragraphs = cleanLines([...(input.paragraphs ?? []), ...(input.bodyLines ?? [])]);
  const details = (input.details ?? []).filter((detail) => detail.label && detail.value);
  const highlightLines = cleanLines(input.highlight?.lines ?? []);
  const actionLabel = input.actionLabel ?? "Continue";
  const secondaryLabel = input.secondaryLabel ?? "Open link";

  const text = [
    input.title,
    "",
    ...cleanLines([input.eyebrow, input.intro]),
    ...(paragraphs.length > 0 ? ["", ...paragraphs] : []),
    ...(details.length > 0 ? ["", ...details.map((detail) => `${detail.label}: ${detail.value}`)] : []),
    ...(highlightLines.length > 0
      ? ["", input.highlight?.title ?? "Details", ...highlightLines]
      : []),
    ...(input.notice ? ["", input.notice] : []),
    ...(actionHref ? ["", actionLabel, actionHref] : []),
    ...(secondaryHref ? ["", secondaryLabel, secondaryHref] : []),
    "",
    "iTrader.im",
    "Buy • Sell • Upgrade",
    "hello@itrader.im",
  ].join("\n");

  const detailsHtml = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border:1px solid #1e2a46;border-radius:10px;">
        ${details
          .map(
            (detail) => `<tr>
              <td style="padding:10px 14px;border-bottom:1px solid #1e2a46;font-family:${FONT};font-size:13px;line-height:18px;color:${MUTED};width:34%;">${escapeHtml(detail.label)}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #1e2a46;font-family:${FONT};font-size:15px;line-height:22px;color:#ffffff;">${escapeHtml(detail.value)}</td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const highlightHtml = highlightLines.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;background:rgba(255,255,255,0.05);border:1px solid #1e2a46;border-radius:10px;">
        <tr>
          <td style="padding:14px 16px;">
            ${
              input.highlight?.title
                ? `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${BLUE};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-align:${align};">${escapeHtml(input.highlight.title)}</p>`
                : ""
            }
            ${highlightLines.map((line) => paragraphHtml(line, align)).join("")}
          </td>
        </tr>
      </table>`
    : "";

  const noticeHtml = input.notice
    ? `<p style="margin:16px 0 0 0;padding:12px 14px;border:1px solid #1e2a46;border-radius:8px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};text-align:${align};">${escapeHtml(input.notice)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#000000;">
    ${
      input.preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#000000;">${escapeHtml(input.preheader)}</div>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;">
      <tr>
        <td align="center" style="padding:28px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border:1px solid #1e2a46;border-radius:14px;background-color:#0f1628;">
            <tr>
              <td align="center" style="padding:26px 24px 14px 24px;">
                <img src="${EMAIL_LOGO_URL}" alt="iTrader.im" width="230" style="display:block;width:230px;max-width:100%;height:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 8px 24px;" align="${align}">
                ${
                  input.eyebrow
                    ? `<p style="margin:0 0 12px 0;font-family:${FONT};font-size:13px;line-height:18px;color:${BLUE};font-weight:700;letter-spacing:0.14em;text-transform:uppercase;text-align:${align};">${escapeHtml(input.eyebrow)}</p>`
                    : ""
                }
                <h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:800;color:#ffffff;text-align:${align};">${escapeHtml(input.title)}</h1>
                ${input.intro ? paragraphHtml(input.intro, align) : ""}
                ${paragraphs.map((paragraph) => paragraphHtml(paragraph, align)).join("")}
                ${detailsHtml}
                ${highlightHtml}
                ${actionHref ? buttonHtml(actionHref, actionLabel) : ""}
                ${
                  secondaryHref
                    ? `<p style="margin:14px 0 0 0;font-family:${FONT};font-size:14px;line-height:22px;text-align:${align};"><a href="${escapeHtml(secondaryHref)}" style="color:${BLUE};text-decoration:underline;">${escapeHtml(secondaryLabel)}</a></p>`
                    : ""
                }
                ${noticeHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 24px;border-top:1px solid #1e2a46;">
                <p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};text-align:center;">
                  iTrader.im<br />
                  Buy &bull; Sell &bull; Upgrade<br />
                  <a href="mailto:hello@itrader.im" style="color:${MUTED};text-decoration:none;">hello@itrader.im</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { text, html };
}
