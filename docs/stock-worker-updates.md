# Private Stock Worker updates

Version 1.1.6 introduces optional startup updates for Preview only. Production update
requests fail closed. The app does not start stock jobs during its update check.
An unavailable check or declined update leaves the installed version usable.

## Hosting and access

The staging Supabase project `syneonzucehwlghqmfbg` owns the private
`stock-update-releases` bucket. No public object policy is required. The website
checks the existing admin role and desktop allowlist; the native endpoint checks
the existing revocable device session. Both limit requests. Each request creates
a new ten-minute signed download URL, so the Stock Reviews button never expires.
Do not put storage service credentials in the desktop app.

The organisation spend cap was disabled with the owner's approval on 23 October
2026. Staging's global file limit is 250 MB; this bucket is limited to 150 MiB.
Storage and downloads consume the existing shared Pro allowances. Other buckets
retain their own limits and access policies.

## Release trust

The release envelope signs the exact base64 payload bytes with RSA-PSS/SHA-256
(32-byte salt). The app and server pin the same public key. Payload fields are
`version`, `channel`, `objectKey`, `fileName`, `size`, and `sha256`.
The app permits only a newer numeric version, the Preview channel, and the exact
staging storage object path. Redirects are rejected. Size and SHA-256 are checked
before setup runs. Failed or cancelled downloads remove partial files.

The signing private key is kept outside the repository and installers. Keep a
secure backup under the owner's control. Changing the pinned key requires a
planned transition release; do not replace it casually. Manifest signing does
not provide Windows Authenticode signing; this remains an unsigned internal app.

## Publish a release

1. Update the native and runtime version constants together, run the repository
   release gates, and commit the reviewed candidate on staging.
2. Run `scripts/stock-update-desktop/build.ps1` from that clean checkout.
3. Verify native tests, credential audits and staging acceptance.
4. Run `node scripts/stock-update-desktop/publish-update.mjs RELEASE_DIRECTORY PRIVATE_KEY_PATH`.
   The script verifies build size/hash and the signing key, uploads immutable
   versioned files, downloads the installer to verify its stored hash, then
   activates `preview/latest.json`. Never overwrite a released installer.
5. Verify the Stock Reviews download and native startup check against staging.

The app closes and releases its single-instance mutex before opening setup.
Setup preserves encrypted sign-in sessions and downloads pinned dependencies
before changing installed runtime files. Normal setup offers to reopen the app.
The first upgrade from 1.1.5 requires the website download because 1.1.5 does not
contain the updater. Subsequent versions can update through the app.
