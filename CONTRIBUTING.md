# Contributing

Anchor is a Tauri 2 desktop app with a React editor and a Rust backend. It is intentionally local-first: markdown files on disk, comment sidecars next to those files, and Claude Code through the user's local CLI.

## Setup

```bash
npm install
npm run tauri dev
```

Vite runs on `http://localhost:1420`.

## Checks Before Opening A PR

```bash
npm run lint
npm run build
npm run test:e2e
cargo check --manifest-path src-tauri/Cargo.toml
npm audit --audit-level=moderate
```

For Rust dependency advisories:

```bash
cargo audit --file src-tauri/Cargo.lock --target-os macos --target-arch aarch64
```

## Product Rules

- Keep Claude Code as the only AI runtime unless the product direction changes.
- Do not add API-key screens, hosted document storage, or cloud sync.
- The editor is the authoritative writer. Claude can read context, but file edits should be applied through Anchor.
- Preserve markdown files as the user-facing source of truth.
- Keep `DESIGN.md` current when UI patterns or primitives change.

## Release Builds

Release packaging is documented in [docs/distribution.md](docs/distribution.md).

Made by [santiagoalonso.com](https://santiagoalonso.com)
