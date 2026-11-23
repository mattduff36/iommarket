# Oracle Stock Update pilot

The pilot uses the existing Oracle RustDesk-Server. Run only Preview until both administrators can launch and stop their own scoped work and the review, apply and repeat tests have passed. Production requires a separate release decision and pairing. Keep Windows available for fallback and for dealers that restrict traffic from Oracle.

## Host readiness, 22 November 2026

SSH from MPDEE-SERVER verified aarch64, 5,909 MiB RAM, 38 GB initially available, no swap, and both RustDesk units active. The private test account is `itrader-probe`. The host probe installs Node v22.23.3 after checking the Linux ARM64 archive against the Node release manifest, Sharp 0.35.5, Playwright 1.58.2, Chromium build 1208 and Xvfb. It installs Ubuntu libraries through apt with removals disabled. The test user owns no application or storage credentials. On Oracle, run `bash oracle-preview-probe.sh` as the sudo-capable ubuntu operator. A dealer returning a non-success status makes the probe exit non-zero even when both Chromium launches pass.

| Check | Observation |
| --- | --- |
| Sharp conversion | Produced a 90-byte PNG |
| Athol used cars | Headless Chromium launched but the dealer returned HTTP 403. A plain HTTPS client got 200. The actual headed connector under Xvfb returned 61 vehicles across six pages. |
| BCC used cars | Headed Chromium under Xvfb returned 200 and the expected dealership title. |
| Mike's Motors used cars | Headed Chromium returned 200. The registry selector matched 13 elements and the page contained 24 distinct vehicle detail links. |

The actual Mike's Motors pipeline subsequently returned 23 cars, 9 vans and 0 bikes. All three sources reported OK. Twenty-one cars and all nine vans had image URLs. This was a public connector test with no job lease or application writes. Across 139 one-second samples the worker cgroup peaked at 1,294 MiB and 67.1% of one CPU with a 65% quota. All 278 local signal/relay TCP connections succeeded. The slowest handshake took 4.81 ms. RustDesk reported zero restarts.

## Install and operate Preview

From the staging checkout run `node scripts/stock-update-desktop/package-oracle.mjs`. Archive the contents of its printed release directory and send only that archive and the installer to the VM over verified SSH. After the host probe completes the runtime checks, run `bash oracle-install-preview.sh release.tgz`. The first-install script expects an unused `/opt/itrader-stock`. It installs the service template and shared lock. The two controllers remain stopped pending pairing.

Use the following commands on the VM for admin1. Substitute admin2 for the second administrator. Open the invitation while signed into the corresponding Preview account. Once paired, run the service. Renewal uses the same pairing command after stopping the instance and revoking the old device. To revoke remotely, open Admin → Desktop stock worker in Preview and remove the named device.

```sh
sudo -u itrader-stock-admin1 /opt/itrader-stock/runtime/bin/node /opt/itrader-stock/controller.mjs pair admin1
sudo systemctl enable --now itrader-stock-preview@admin1
sudo systemctl status itrader-stock-preview@admin1
sudo journalctl -u itrader-stock-preview@admin1 --since today
```

For rollback, stop and disable each installed instance with `sudo systemctl disable --now itrader-stock-preview@admin1` and its admin2 equivalent. Keep job IDs and the last Stock Reviews state for any interrupted work. The service has no listening socket and exposes no new network port.

## Acceptance procedure

1. Each allowlisted administrator approves their own named Preview device at `https://itrader.dev/admin/stock-worker` when prompted. Check the environment and device name. Repeat the pairing after 30 days or after revocation. Never copy a Windows session to the VM.
2. Select the Oracle device in Preview Stock Reviews, then queue one known accessible dealer. Record the job and report IDs. Confirm the other administrator cannot see or operate the first administrator's device. A second concurrent request must leave the first job running and must never result in two worker processes.
3. Compare vehicle counts, identities, proposed additions, removals and photos with the dealer. Exercise Stop during a scoped run. Let the current job finish, then confirm no further leases. Verify an incomplete source cannot authorise removals and missing required photos prevent application.
4. Approve an appropriate Preview report using the ordinary review screen. Apply on Oracle. Record the completed apply job, committed changes and a working uploaded listing photo. Repeat the same unchanged dealer scan. Verify no duplicate changes or photo applications. If the dealer changed between runs, reconcile the actual delta.
5. During a full run, sample the entire worker cgroup, inspect throttling, and check the signal and relay services. Exercise a real RustDesk remote-control connection while the worker runs. A successful TCP handshake alone does not establish interactive responsiveness.

## Recovery and backups

Stop accepting new work and use Stock Reviews Stop to finish the current job. Disable the Oracle controller instances, revoke each Oracle device on its environment's admin stock-worker page, and switch the launch choice back to Windows. Check any interrupted lease and report status in Stock Reviews before retrying through the website. Leave RustDesk running.

Keep the reviewed release, service configuration and deployment instructions with the project and NAS backup. Re-pair after a restore. Exclude session files, browser profiles and pairing material from ordinary backups. The RustDesk application archive, SHA-256 manifest and recovery instructions are in `\\192.168.0.14\Shared\BACKUP\RustDesk-Server\2026-11-22`. The archive digest matched its manifest on 22 November. The separate Oracle boot-volume backup was reported by the owner. Full-volume restoration is a last resort because it also rolls back RustDesk.
