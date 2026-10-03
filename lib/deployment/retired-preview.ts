import { NextResponse, type NextRequest } from "next/server";
import type { RuntimeEnv } from "@/lib/runtime-env";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Page not found | iTrader.im</title><style>
:root{color-scheme:dark;font-family:Arial,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at top,#102d4b,#080e19 65%);color:#f4f7fb;padding:32px}main{max-width:580px;text-align:center}.brand{font-size:30px;font-weight:800;letter-spacing:-1px}.brand span{color:#54caff}.code{margin:56px 0 12px;color:#54caff;font-size:88px;font-weight:800;letter-spacing:-5px}h1{font-size:clamp(26px,5vw,38px);margin:0 0 20px}p{color:#b9c8d8;line-height:1.7;margin:0 0 32px}a{display:inline-block;background:#54caff;color:#061323;padding:14px 22px;border-radius:8px;font-weight:700;text-decoration:none}a:focus-visible{outline:3px solid white;outline-offset:5px}footer{margin-top:48px;font-size:13px;color:#93a8bc}
</style></head><body><main><div class="brand">iTrader<span>.im</span></div><div class="code">404</div><h1>This page is no longer available</h1><p>The previous preview address has been retired.<br>Visit iTrader to buy and sell vehicles on the Isle of Man.</p><a href="https://itrader.im/">Visit iTrader.im</a><footer>Buy · Sell · Upgrade</footer></main></body></html>`;

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
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}
