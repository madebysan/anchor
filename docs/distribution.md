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

The universal build needs a Rust toolchain with the `x86_64-apple-darwin`
target. If Homebrew's `rust` is installed it comes first in `PATH` and has no
Intel target, so put rustup's toolchain first for the build:
`PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" npm run release:dmg`
(found while releasing 0.1.3 on 2026-10-12).

This builds the app bundle with the configured Developer ID Application
identity, creates the DMG, signs the DMG, verifies the image checksum, and
prints the artifact path:

```text
src-tauri/target/universal-apple-darwin/release/bundle/dmg/Anchor_0.1.2_universal.dmg
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
spctl --assess --type open --context context:primary-signature --verbose=4 "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Anchor_0.1.2_universal.dmg"
spctl --assess --type execute --verbose=4 "src-tauri/target/universal-apple-darwin/release/bundle/macos/Anchor.app"
codesign --verify --deep --strict --verbose=4 "src-tauri/target/universal-apple-darwin/release/bundle/macos/Anchor.app"
hdiutil verify "src-tauri/target/universal-apple-darwin/release/bundle/dmg/Anchor_0.1.2_universal.dmg"
```

Last verified notarized release:

```text
Status: Accepted
Release: Anchor 0.1.2
Tag: v0.1.2
Asset: Anchor-0.1.2-macOS-universal.dmg
Notarization ID: e928cf8c-6483-462c-83ed-25a6ed5e0f21
SHA256: 529422b2191659d766ec689724eb1c97a867e23b8d5a30f0586f55005d490ee8
```

## DMG Design

The plain `hdiutil` DMG is the v0.1 distribution path. It is signed,
notarized, stapled, and accepted by Gatekeeper. A branded DMG layout can wait
for the final branding pass.

## DMG Housekeeping

Do not manually overwrite old DMGs on Desktop. Build into
`src-tauri/target/release/bundle/dmg/`, verify there, then copy only the final
artifact to a release folder if needed. macOS TCC can block Desktop overwrites.

## In-app updates

Since 2026-10-13 Anchor checks for updates once per launch (release builds
only) with Tauri's updater, reading
`https://github.com/madebysan/anchor/releases/latest/download/latest.json`.
The feed works only once the repo is public.

- Signing key: `~/.tauri/anchor-updater.key` (outside the repo), with its
  password in the login keychain item `anchor-tauri-updater`. Back both up;
  without them, installed copies can't verify later updates. The public key is
  in `src-tauri/tauri.conf.json`.
- `npm run release:dmg` loads the key and also writes
  `bundle/macos/Anchor.app.tar.gz` and its `.sig`.
- `scripts/make-latest-json.sh <release-notes.md>` writes `latest.json`.
- Upload the DMG, `Anchor.app.tar.gz` and `latest.json` to the GitHub release.
- Before the first release with the updater, run `scripts/update-test.sh` once (it builds a throwaway 99.0.0 and serves a local feed), click **Install and Restart** in the test copy, then `scripts/update-test.sh verify <work dir>`.
