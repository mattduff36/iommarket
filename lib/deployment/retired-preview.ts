import { NextResponse, type NextRequest } from "next/server";
import type { RuntimeEnv } from "@/lib/runtime-env";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Page not found | iTrader.im</title><style>
:root{color-scheme:dark;font-family:Inter,Arial,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;background:#050505;color:#f5f5f5;padding:48px 24px}main{width:100%;max-width:640px;text-align:center}.brand{display:block;width:min(100%,360px);height:auto;margin:0 auto 48px}.message{background:#0A0A0B;border:1px solid #28282b;border-top:3px solid #FF1F1F;border-radius:12px;padding:36px 32px 40px}.code{margin:0 0 12px;color:#FF1F1F;font-size:clamp(64px,12vw,88px);line-height:1;font-weight:800;letter-spacing:-4px}h1{font-size:clamp(25px,5vw,34px);line-height:1.2;letter-spacing:-.7px;margin:0 0 20px}p{color:#b6b6bd;line-height:1.7;margin:0 auto 28px;max-width:450px}a{display:inline-block;background:#FF1F1F;color:#fff;padding:14px 24px;border-radius:8px;font-weight:700;text-decoration:none}a:hover{background:#df1515}a:focus-visible{outline:3px solid white;outline-offset:5px}footer{margin-top:28px;font-size:13px;letter-spacing:.8px;color:#909098}@media(max-width:420px){body{padding:32px 18px}.brand{margin-bottom:32px}.message{padding:28px 20px 32px}}
</style></head><body><main><img class="brand" src="https://itrader.im/images/logo-itrader-hq.png" width="1399" height="392" alt="iTrader.im"><section class="message" aria-labelledby="page-title"><div class="code">404</div><h1 id="page-title">This page is no longer available</h1><p>The previous preview address has been retired.<br>Visit iTrader to buy and sell vehicles on the Isle of Man.</p><a href="https://itrader.im/">Visit iTrader.im</a></section><footer>Buy · Sell · Upgrade</footer></main></body></html>`;

/** Bind the retired hostname to production only after the staging relay cutover. */
export function retiredPreviewResponse(request: NextRequest, env: RuntimeEnv = process.env) {
  const host = (request.headers.get("host") ?? request.nextUrl.host).toLowerCase();
  if (env.VERCEL_ENV !== "production" || host !== "preview.itrader.im") return null;
  return new NextResponse(request.method === "HEAD" ? null : PAGE, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; img-src https://itrader.im/images/logo-itrader-hq.png; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}
