#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRODUCT_NAME="$(node -e "const fs = require('fs'); const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')); process.stdout.write(c.productName);")"
VERSION="$(node -e "const fs = require('fs'); const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')); process.stdout.write(c.version);")"
SIGNING_IDENTITY="$(node -e "const fs = require('fs'); const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')); process.stdout.write(c.bundle?.macOS?.signingIdentity || '');")"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  BUNDLE_ARCH="aarch64"
else
  BUNDLE_ARCH="$ARCH"
fi

APP_PATH="src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app"
OUT_DIR="src-tauri/target/release/bundle/dmg"
DMG_PATH="${OUT_DIR}/${PRODUCT_NAME}_${VERSION}_${BUNDLE_ARCH}.dmg"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/anchor-dmg.XXXXXX")"

cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT

TAURI_ARGS=(tauri build -- --bundles app)
if [ "${ANCHOR_NO_SIGN:-0}" = "1" ]; then
  TAURI_ARGS+=(--no-sign)
fi

npm run "${TAURI_ARGS[@]}"

if [ ! -d "$APP_PATH" ]; then
  echo "Missing built app: $APP_PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
ditto "$APP_PATH" "$STAGING/${PRODUCT_NAME}.app"
ln -s /Applications "$STAGING/Applications"

hdiutil create \
  -volname "${PRODUCT_NAME} ${VERSION}" \
  -srcfolder "$STAGING" \
  -format UDZO \
  -ov \
  "$DMG_PATH"

if [ "${ANCHOR_NO_SIGN:-0}" != "1" ] && [ -n "$SIGNING_IDENTITY" ]; then
  codesign --force --sign "$SIGNING_IDENTITY" --timestamp "$DMG_PATH"
fi

hdiutil verify "$DMG_PATH"
echo "$DMG_PATH"
