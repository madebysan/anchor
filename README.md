# Anchor

A desktop document editor where AI instructions live anchored to your text. Highlight a passage, type an instruction, and your local Claude Code edits the file in place. ⌘Z if you don't like it.

No API keys. Markdown files on disk. Cross-platform via Tauri.

## How it works

1. Open a folder of `.md` files.
2. Pick a note. Highlight a passage.
3. Add a comment with an instruction (`@editor fix the grammar`, `@copywriter tighten this`).
4. Local Claude Code reads the file, applies the edit, saves.
5. The change is highlighted. Keep it (do nothing) or ⌘Z to revert.

## Why this exists

inlineai (the web parent) is a Vercel-deployed React app that calls the Anthropic API directly. Each comment costs tokens, every key is in the bundle, and notes live in localStorage. Anchor fixes all three:

- **Uses Claude Code locally.** Auth lives in your `~/.claude/`. Your Pro/Max subscription quota covers it. No API key flow.
- **Files on disk.** Notes are real `.md` files in a folder you choose. Open them in any editor. No storage quota.
- **Native desktop.** Tauri shell, ~10MB binary, no bundled Chromium.

## Status

Forked from inlineai 2026-05-06, then shipped as a working .app the same day.

**What works:**
- Tauri shell + Vite + React + Tiptap editor
- Local Claude Code integration: per-doc sessions (token-cheap follow-ups across comments), prompt-injected today's date, `--resume` with auto-retry on session expiry
- Hierarchical sidebar — folders + nested `.md` files, empty folders, search, expand/collapse persistence, context menus for common file/folder actions
- Personas: editor / copywriter / researcher / challenger; default-persona setting; `Note:` opt-out for plain notes; per-comment persona override dropdown
- Auto-apply UX — claude's response replaces the highlighted passage in the editor; ⌘Z reverts
- Comment anchors restore visual highlights after markdown reload when the original passage can still be found
- Settings dialog (General / Personas / Shortcuts) with notes folder, theme, editor size, line height, reset
- Native save dialogs for export, native folder picker for notes location, Reveal in Finder
- macOS `.app` bundle with PATH augmentation so it finds `claude` outside Finder's default PATH

**Known limitations:**
- Comment anchor restoration is still best-effort. If the anchored passage is heavily rewritten outside the app, Anchor may not be able to reattach the visual highlight.
- File moving is intentionally conservative: move-to-folder uses known folders from the sidebar rather than a free-form picker.
- Release builds are signed and notarized when built through the release scripts.

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
