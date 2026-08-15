import { escapeHtml } from "@/lib/email/client";

export function renderBrandedEmail(input: {
  title: string;
  intro: string;
  bodyLines: string[];
}): { text: string; html: string } {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const logoUrl = `${appUrl}/images/logo-itrader-hq.png`;
  const text = [input.title, "", input.intro, "", ...input.bodyLines, "", "iTrader.im"].join(
    "\n",
  );
  const bodyHtml = input.bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#d7dff2;">${escapeHtml(line)}</p>`,
    )
    .join("");

  const html = `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;padding:0;background-color:#000000;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000">
            <tr>
              <td align="center" style="padding:28px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border:1px solid #1e2a46;border-radius:14px;background:#0f1628;">
                  <tr>
                    <td align="center" style="padding:26px 24px 14px 24px;">
                      <img src="${logoUrl}" alt="iTrader.im" width="230" style="display:block;width:230px;max-width:100%;height:auto;border:0;" />
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 24px 24px 24px;">
                      <h1 style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:26px;line-height:32px;font-weight:800;color:#ffffff;">
                        ${escapeHtml(input.title)}
                      </h1>
                      <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#d7dff2;">
                        ${escapeHtml(input.intro)}
                      </p>
                      ${bodyHtml}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

  return { text, html };
}
