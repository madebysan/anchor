# inline-mac

A desktop document editor where AI instructions live anchored to your text. Highlight a passage, type an instruction, and your local Claude Code edits the file in place. ⌘Z if you don't like it.

No API keys. Markdown files on disk. Cross-platform via Tauri.

## How it works

1. Open a folder of `.md` files.
2. Pick a note. Highlight a passage.
3. Add a comment with an instruction (`@editor fix the grammar`, `@copywriter tighten this`).
4. Local Claude Code reads the file, applies the edit, saves.
5. The change is highlighted. Keep it (do nothing) or ⌘Z to revert.

## Why this exists

inlineai (the web parent) is a Vercel-deployed React app that calls the Anthropic API directly. Each comment costs tokens, every key is in the bundle, and notes live in localStorage. inline-mac fixes all three:

- **Uses Claude Code locally.** Auth lives in your `~/.claude/`. Your Pro/Max subscription quota covers it. No API key flow.
- **Files on disk.** Notes are real `.md` files in a folder you choose. Open them in any editor. No storage quota.
- **Native desktop.** Tauri shell, ~10MB binary, no bundled Chromium.

## Status

Forked 2026-05-06. Currently:

- Tauri shell scaffolded ✓
- Vite + React + Tiptap UI ports from inlineai ✓
- Window opens with the editor ✓
- Claude Code integration **next** (the AI layer is currently broken — `/api/ai` route is gone, no replacement yet)
- Markdown-on-disk persistence **next** (still using localStorage from the parent)

See [`backlog.md`](backlog.md) for the work list.

## Build

```bash
npm install
npm run tauri dev      # dev window with hot reload
npm run tauri build    # signed/notarizable .app + .dmg
```

Requires Node 18+ and Rust 1.77+ (`rustup` or `brew install rust`).

## Made by

[santiagoalonso.com](https://santiagoalonso.com)
