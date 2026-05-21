# Distribution Runbook

Anchor builds a signed macOS app bundle and a signed DMG. Use the local DMG
script because it avoids Tauri's Finder/AppleScript DMG layout step, which has
hung on this machine before.

## Unsigned Local Build

```bash
npm run tauri build -- --bundles app --no-sign
```

The macOS app lands at
`src-tauri/target/release/bundle/macos/Anchor.app`.

## Unsigned Local DMG

```bash
ANCHOR_NO_SIGN=1 npm run release:dmg
```

Use this for quick local checks only. The script builds the app bundle, stages
it with an Applications symlink, creates a compressed DMG with `hdiutil`, and
verifies it before printing the artifact path.

## Signed Release DMG

```bash
npm run release:dmg
```

This builds the app bundle with the configured Developer ID Application
identity, creates the DMG, signs the DMG, verifies the image checksum, and
prints the artifact path:

```text
src-tauri/target/release/bundle/dmg/Anchor_0.1.0_aarch64.dmg
```

Current signing identity:

```text
Developer ID Application: Santiago Alonso Alexandre (QAMM2A6WRQ)
```

## Notarization

```bash
npm run release:notarize
```

This submits the DMG through the existing local `notarytool` keychain profile,
waits for Apple to finish processing it, staples the notarization ticket, and
runs a Gatekeeper check on the DMG.

Use this combined command for a full Mac release pass:

```bash
npm run release:mac
```

Expected validation commands:

```bash
spctl --assess --type open --context context:primary-signature --verbose=4 "src-tauri/target/release/bundle/dmg/Anchor_0.1.0_aarch64.dmg"
spctl --assess --type execute --verbose=4 "src-tauri/target/release/bundle/macos/Anchor.app"
codesign --verify --deep --strict --verbose=4 "src-tauri/target/release/bundle/macos/Anchor.app"
hdiutil verify "src-tauri/target/release/bundle/dmg/Anchor_0.1.0_aarch64.dmg"
```

Last verified notarized release:

```text
Status: Accepted
Release: Anchor 0.1.0
Tag: v0.1.0
Asset: Anchor-0.1.0-Apple-Silicon.dmg
SHA256: db5eca71d7e46740890ed607655a3c760bc75ded7e57b03579cdea79947c2ac7
```

## DMG Design

The plain `hdiutil` DMG is the v0.1 distribution path. It is signed,
notarized, stapled, and accepted by Gatekeeper. A branded DMG layout can wait
for the final branding pass.

## DMG Housekeeping

Do not manually overwrite old DMGs on Desktop. Build into
`src-tauri/target/release/bundle/dmg/`, verify there, then copy only the final
artifact to a release folder if needed. macOS TCC can block Desktop overwrites.
