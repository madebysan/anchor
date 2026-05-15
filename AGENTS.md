# Anchor Codex Guide

Native desktop markdown editor where AI instructions are anchored to text passages. Forked from `~/Projects/inlineai/` on 2026-05-06; this fork is the daily-driver target.

## Stack

- Tauri 2.x shell with Rust backend and native OS webview.
- Vite 6, React 19, TypeScript.
- Tiptap/ProseMirror editor.
- Zustand store at `src/lib/document-store.ts`.
- Tailwind CSS 4, shadcn/ui, Radix.
- AI shells out to the local `claude` CLI through a Tauri command. No API-key fallback, no `@ai-sdk/*`, no Vercel functions.
- Persistence is markdown files on disk. No localStorage for documents, no SQLite.

## Locked Decisions

- Claude Code only. Do not add Codex, OpenCode, Ollama, or API-key fallbacks unless san explicitly changes the product direction.
- If `claude` is unavailable, show install instructions and refuse to run AI.
- Markdown files are user-facing and authoritative.
- AI edits should auto-apply with undo. The editor, not Claude, is the authoritative writer.

## Gotchas

- Finder-launched `.app` bundles have minimal PATH. Keep the PATH augmentation in `src-tauri/src/lib.rs`.
- Do not use `Path::canonicalize` for the selected notes folder containment checks; use the existing `normalize()` helper to avoid symlink breakage.
- Do not use `claude --bare`; it bypasses desired Claude discovery but forces API-key auth.
- Prompts must tell Claude to ignore global response conventions, and `stripCommentary()` should keep stripping leaked preambles.
- Claude may have Read and Write/Edit tools when launched with skipped permissions. Prompts must allow Read but forbid Write/Edit.

## Carryover Rules from inlineai

- Personas are a primitive, not a marketplace.
- Keep the context chip accurate: strategy, character count, and model/context details.
- Token efficiency matters; do not default every request to `full-document`.
- Preserve the Tiptap mount race workaround unless a real readiness callback replaces it.
- Programmatic `editor.commands.setContent(html)` calls must pass `{ emitUpdate: false }`.

## Commands

- `npm install`
- `npm run tauri dev`
- `npm run tauri build`

Vite runs on port `1420`.
