# Distribution Runbook

Anchor builds a signed macOS app bundle and a signed DMG. Use the local DMG
script because it avoids Tauri's Finder/AppleScript DMG layout step, which has
hung on this machine before.

## Unsigned Local Build

```bash
npm run tauri build -- --target universal-apple-darwin --bundles app --no-sign
```

The macOS app lands at
`src-tauri/target/universal-apple-darwin/release/bundle/macos/Anchor.app`.

Universal builds require Rust std targets for both Mac architectures:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

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
src-tauri/target/universal-apple-darwin/release/bundle/dmg/Anchor_0.1.1_universal.dmg
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
spctl --assess --type open --context context:primary-signature --verbose=4 "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Anchor_0.1.1_universal.dmg"
spctl --assess --type execute --verbose=4 "src-tauri/target/universal-apple-darwin/release/bundle/macos/Anchor.app"
codesign --verify --deep --strict --verbose=4 "src-tauri/target/universal-apple-darwin/release/bundle/macos/Anchor.app"
hdiutil verify "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Anchor_0.1.1_universal.dmg"
```

Last verified notarized release:

```text
Status: Accepted
Release: Anchor 0.1.1
Tag: v0.1.1
Asset: Anchor-0.1.1-macOS-universal.dmg
Notarization ID: e68bb318-5057-4743-b1d2-8a4ddb735f62
SHA256: 7c5db4a6034436a387a3013bd821438741dc11cfb0482851a9da70e7dec2c85e
```

## DMG Design

The plain `hdiutil` DMG is the v0.1 distribution path. It is signed,
notarized, stapled, and accepted by Gatekeeper. A branded DMG layout can wait
for the final branding pass.

## DMG Housekeeping

Do not manually overwrite old DMGs on Desktop. Build into
`src-tauri/target/release/bundle/dmg/`, verify there, then copy only the final
artifact to a release folder if needed. macOS TCC can block Desktop overwrites.
