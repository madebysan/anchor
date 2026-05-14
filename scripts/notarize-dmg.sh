#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRODUCT_NAME="$(node -e "const fs = require('fs'); const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')); process.stdout.write(c.productName);")"
VERSION="$(node -e "const fs = require('fs'); const c = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')); process.stdout.write(c.version);")"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  BUNDLE_ARCH="aarch64"
else
  BUNDLE_ARCH="$ARCH"
fi

DMG_PATH="${1:-src-tauri/target/release/bundle/dmg/${PRODUCT_NAME}_${VERSION}_${BUNDLE_ARCH}.dmg}"
PROFILE="${NOTARYTOOL_PROFILE:-notarytool}"

if [ ! -f "$DMG_PATH" ]; then
  echo "Missing DMG: $DMG_PATH" >&2
  exit 1
fi

xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG_PATH"
echo "$DMG_PATH"
