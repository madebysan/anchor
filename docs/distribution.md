# Distribution Runbook

Inline MD builds a working macOS app bundle and DMG. Use the local script for
DMGs because it avoids Tauri's Finder/AppleScript DMG layout step, which has
hung on this machine before.

## Local Build

```bash
npm run tauri build -- --bundles app --no-sign
```

The macOS app lands at
`src-tauri/target/release/bundle/macos/Inline MD.app`.

## Local DMG

```bash
INLINE_MD_NO_SIGN=1 npm run release:dmg
```

The script builds the app bundle, stages it with an Applications symlink, creates
a compressed DMG with `hdiutil`, and verifies it before printing the artifact
path. The output path is:

```text
src-tauri/target/release/bundle/dmg/Inline MD_0.1.0_aarch64.dmg
```

## Signing + Notarization Checklist

Current local preflight: `security find-identity -v -p codesigning` now finds a
valid Developer ID Application identity:

```text
Developer ID Application: Santiago Alonso Alexandre (QAMM2A6WRQ)
```

Next release pass:

1. Confirm Tauri uses the Developer ID Application identity for the `.app`.
2. Build the app and DMG with `npm run release:dmg`.
3. Submit the DMG with `xcrun notarytool submit --keychain-profile "notarytool" --wait`.
4. Staple the notarization ticket with `xcrun stapler staple`.
5. Verify Gatekeeper with `spctl --assess --type open --verbose`.

## DMG Housekeeping

Do not manually overwrite old DMGs on Desktop. Build into
`src-tauri/target/release/bundle/dmg/`, verify there, then copy only the final
artifact to a release folder if needed. macOS TCC can block Desktop overwrites.
