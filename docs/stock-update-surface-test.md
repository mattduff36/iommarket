# Stock Update 1.0.1 Surface checklist

Status: not performed. This is an internal x64 checklist for a later test. It does not record a completed Surface run, an installer hash, or a signature.

Use only the 1.0.1 setup file supplied for this test, together with its SHA-256. Leave any archived 1.0.0 setup file in place. The parent build uses a separate private folder, `private/stock-update-release-1.0.1`, so the 1.0.0 installer stays intact.

The installed application still contains Preview (`itrader.dev`) and Production (`itrader.im`). This test is Preview only. Production is not authorised. Do not select Production. Do not start the worker. Do not turn off SmartScreen or Defender. If Windows blocks the unsigned installer, stop and contact Matt.

Connected staging stock apply is a separate record. It is not a Surface test result.

## Steps

1. Confirm the PC is 64-bit Windows 11. Close Stock Update if it is open.
2. Install. For a fresh-install check, run the supplied 1.0.1 setup. For the upgrade check, start with the archived 1.0.0 setup (or an existing 1.0.0 installation), then follow step 6. No admin password is required. The desktop icon may stay unticked. If Windows blocks it, stop.
3. Sign in. Open **iTrader Stock Update**. Leave **Preview - itrader.dev** selected. Click **Sign in**. Approve this computer and Preview in the browser with the existing iTrader admin account. The app must not ask for a password. The window should show the account name and email.
4. Check. Click **Check connection**. It must not queue, approve, or change stock. Leave **Start worker** unused.
5. Restart. Close the app, open it again, and confirm the Preview session is still signed in. Run **Check connection** again.
6. Upgrade or reinstall. Close the app. Run the 1.0.1 setup. This is an upgrade if step 2 used 1.0.0, or a reinstall if it used 1.0.1; record which was tested. Open the app, confirm Preview is still signed in, and run **Check connection** again.
7. Uninstall. Use **Sign out**, or **Manage devices** on the website, if this PC should not keep access. With the app closed, use Start menu **iTrader → Uninstall Stock Update**. Confirm the program is gone. Uninstall clears this Windows user's saved app session on this PC. It does not revoke website access.
