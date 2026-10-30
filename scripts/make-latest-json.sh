#!/usr/bin/env bash
# Writes latest.json, the feed Anchor's updater reads from the newest GitHub
# Release. Run after scripts/build-dmg.sh; upload latest.json and
# Anchor.app.tar.gz to the release.
#
# Usage: scripts/make-latest-json.sh <release-notes.md> [output]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NOTES_FILE="$1"
OUT="${2:-latest.json}"
VERSION="$(node -e "process.stdout.write(require('./src-tauri/tauri.conf.json').version)")"
BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle/macos"
ARCHIVE="$BUNDLE/Anchor.app.tar.gz"
SIG="$ARCHIVE.sig"
[ -f "$ARCHIVE" ] && [ -f "$SIG" ] || { echo "Missing $ARCHIVE or its .sig; build with the updater key first." >&2; exit 1; }

URL="https://github.com/madebysan/anchor/releases/download/v$VERSION/Anchor.app.tar.gz"
node -e '
const fs = require("fs");
const [version, notesFile, sigFile, url, out] = process.argv.slice(1);
const signature = fs.readFileSync(sigFile, "utf8").trim();
const platform = { signature, url };
const feed = {
  version,
  notes: fs.readFileSync(notesFile, "utf8").trim(),
  pub_date: new Date().toISOString(),
  // One universal build serves both Mac architectures.
  platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
};
fs.writeFileSync(out, JSON.stringify(feed, null, 2) + "\n");
' "$VERSION" "$NOTES_FILE" "$SIG" "$URL" "$OUT"
echo "$OUT (version $VERSION)"
