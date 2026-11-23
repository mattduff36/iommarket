#!/bin/bash
# Isolated runtime probe. Run as ubuntu on the ARM64 host.
set -euo pipefail
umask 077
user=itrader-probe
root=/var/lib/itrader-probe
[[ $(uname -m) == aarch64 ]]
if ! id "$user" >/dev/null 2>&1; then
  sudo useradd --system --create-home --home-dir "$root" --shell /usr/sbin/nologin "$user"
fi
[[ $(getent passwd "$user" | cut -d: -f6) == "$root" ]]
sudo -u "$user" bash -se <<'INSTALL'
set -euo pipefail
umask 077
cd /var/lib/itrader-probe
file=node-v22.23.3-linux-arm64.tar.xz
base=https://nodejs.org/dist/v22.23.3
curl -fsSLO "$base/$file"
curl -fsSL "$base/SHASUMS256.txt" | awk -v f="$file" '$2 == f' | sha256sum --check --strict
tar -xf "$file"
export PATH="$PWD/node-v22.23.3-linux-arm64/bin:/usr/bin:/bin"
npm install --ignore-scripts --no-audit --no-fund --save-exact @playwright/test@1.58.2 sharp@0.35.5
node -e 'require("sharp")({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer().then(b=>console.log(process.version,process.arch,"PNG bytes",b.length))'
./node_modules/.bin/playwright install chromium
INSTALL
# Install the package manager dependencies explicitly, never execute user-owned code as root.
sudo env NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get --no-remove -y install --no-install-recommends xvfb xauth libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libatspi2.0-0 libpango-1.0-0 libcairo2
sudo systemd-run --quiet --wait --pipe --collect --uid="$user" --working-directory="$root" -p CPUQuota=65% -p MemoryMax=2G -p Nice=10 /usr/bin/xvfb-run -a -s '-screen 0 1440x1100x24 -nolisten tcp' "$root/node-v22.23.3-linux-arm64/bin/node" --input-type=module - <<'PROBE'
import { chromium } from "@playwright/test";
for (const [headless, url] of [[true,"https://www.athol.im/used-cars/"],[false,"https://www.bcccars.im/used-cars/"]]) {
  const browser = await chromium.launch({headless});
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, {waitUntil:"domcontentloaded",timeout:30000});
    console.log(JSON.stringify({headless,url,status:response?.status(),title:await page.title()}));
    if (!response?.ok()) process.exitCode = 1;
  } finally { await browser.close(); }
}
PROBE
