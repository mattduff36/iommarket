#!/bin/bash
# First installation, after the host probe. Takes a reviewed package-oracle tarball.
set -euo pipefail
umask 077
bundle=$(realpath "${1:?Provide the release archive}")
target=/opt/itrader-stock
probe=/var/lib/itrader-probe
[[ $(uname -m) == aarch64 && -f "$bundle" && ! -e "$target" ]]
stage=$(mktemp -d /var/tmp/itrader-release.XXXXXXXX)
chmod 0755 "$stage"
tar -xzf "$bundle" -C "$stage"
test -f "$stage/worker/package-lock.json"
getent group itrader-stock >/dev/null || sudo groupadd --system itrader-stock
for profile in admin1 admin2; do
  account="itrader-stock-$profile"
  state="/var/lib/itrader-stock-preview-$profile"
  id "$account" >/dev/null 2>&1 || sudo useradd --system -g itrader-stock -d "$state" -s /usr/sbin/nologin "$account"
  sudo install -d -m 0700 -o "$account" -g itrader-stock "$state"
done
# Re-extract the verified Node archive as the release builder. Install only the
# exported npm lock. Download browsers as the builder before making the tree immutable to the service.
sudo install -o "$(id -un)" -m 0600 "$probe/node-v22.23.3-linux-arm64.tar.xz" "$stage/node-v22.23.3-linux-arm64.tar.xz"
(cd "$stage"; curl -fsSL https://nodejs.org/dist/v22.23.3/SHASUMS256.txt | awk '$2=="node-v22.23.3-linux-arm64.tar.xz"' | sha256sum --check --strict)
tar -xf "$stage/node-v22.23.3-linux-arm64.tar.xz" -C "$stage"
mv "$stage/node-v22.23.3-linux-arm64" "$stage/runtime"
export PATH="$stage/runtime/bin:/usr/bin:/bin"
(cd "$stage/worker"; npm ci --ignore-scripts --omit=dev --no-audit --no-fund
 PLAYWRIGHT_BROWSERS_PATH="$stage/browsers" ./node_modules/.bin/playwright install chromium)
sudo install -d -m 0755 "$target"
sudo cp -a "$stage"/{runtime,worker,browsers,controller.mjs} "$target/"
sudo chown -R root:root "$target"
sudo chmod -R a+rX,go-w "$target"
sudo install -m 0644 "$stage/itrader-stock-preview@.service" /etc/systemd/system/
sudo install -m 0644 "$stage/itrader-stock-tmpfiles.conf" /etc/tmpfiles.d/
sudo systemd-tmpfiles --create /etc/tmpfiles.d/itrader-stock-tmpfiles.conf
sudo systemctl daemon-reload
echo "Installed Preview runtime. Pair both profiles individually before starting their controllers."
