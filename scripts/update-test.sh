#!/bin/bash
# Update test for Anchor's in-app updates (Tauri updater), before a release.
# Builds the current version with its feed pointed at a local server, builds a
# throwaway 99.0.0 signed with the updater key (~/.tauri/anchor-updater.key;
# its password is read from the login keychain, never printed), notarizes
# both, serves the feed and launches the test copy. Click "Install and
# Restart" in its dialog, then run: scripts/update-test.sh verify <work dir>
# It should report 99.0.0, a valid signature and "Notarized Developer ID".
# Afterwards trash the work folder and src-tauri/target/release/bundle/macos.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$HOME/.cargo/bin:$PATH"
ID="Developer ID Application: Santiago Alonso Alexandre (QAMM2A6WRQ)"

if [ "${1:-}" = "verify" ]; then
  W="$2"; INST="$W/install/Anchor.app"
  V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INST/Contents/Info.plist")"
  echo "installed version: $V"; cat "$W/server.log"
  pgrep -fl "$W/install" || echo "(not running)"
  codesign --verify --deep --strict "$INST" && echo sig-ok
  spctl -a -vv "$INST" 2>&1 | grep source
  exit 0
fi

W="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/anchor-update-test.XXXXXX")" && pwd -P)"
PORT="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
echo "work: $W port: $PORT"
notarize() {
  ditto -c -k --keepParent "$1" "$W/notary.zip"
  xcrun notarytool submit "$W/notary.zip" --keychain-profile notarytool --wait | grep 'status:' | tail -1
  xcrun stapler staple -q "$1"
}
BUNDLE=src-tauri/target/release/bundle/macos

echo "==> N with the feed at 127.0.0.1:$PORT"
npx tauri build --bundles app -c "{\"bundle\":{\"createUpdaterArtifacts\":false},\"plugins\":{\"updater\":{\"endpoints\":[\"http://127.0.0.1:$PORT/latest.json\"],\"dangerousInsecureTransportProtocol\":true}}}" > "$W/build-n.log" 2>&1
mkdir -p "$W/install" "$W/feed"
ditto "$BUNDLE/Anchor.app" "$W/install/Anchor.app"
notarize "$W/install/Anchor.app"

echo "==> Throwaway 99.0.0 with a signed update archive"
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/anchor-updater.key"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s anchor-tauri-updater -a signing-key-password -w)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
npx tauri build --bundles app -c '{"version":"99.0.0"}' > "$W/build-next.log" 2>&1
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
notarize "$BUNDLE/Anchor.app"
# Rebuild the archive from the notarized app and sign it again with the updater key.
cp "$BUNDLE/Anchor.app.tar.gz.sig" "$W/feed/build.sig"
tar -czf "$W/feed/Anchor.app.tar.gz" -C "$BUNDLE" Anchor.app
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s anchor-tauri-updater -a signing-key-password -w)" \
  npx tauri signer sign -f "$HOME/.tauri/anchor-updater.key" "$W/feed/Anchor.app.tar.gz" > "$W/sign.log" 2>&1
node -e '
const fs=require("fs"); const [sig,port,out]=process.argv.slice(1);
const p={signature:fs.readFileSync(sig,"utf8").trim(),url:`http://127.0.0.1:${port}/Anchor.app.tar.gz`};
fs.writeFileSync(out, JSON.stringify({version:"99.0.0",notes:"Throwaway build for the update test.",pub_date:new Date().toISOString(),platforms:{"darwin-aarch64":p,"darwin-x86_64":p}},null,2));
' "$W/feed/Anchor.app.tar.gz.sig" "$PORT" "$W/feed/latest.json"
trash "$W/feed/build.sig"

python3 -I -m http.server "$PORT" --bind 127.0.0.1 --directory "$W/feed" > "$W/server.log" 2>&1 &
echo "server pid $!"
open -n "$W/install/Anchor.app"
echo "launched N; waiting for the feed read"
for _ in $(seq 1 60); do grep -q 'GET /latest.json' "$W/server.log" && break; sleep 1; done
cat "$W/server.log"
